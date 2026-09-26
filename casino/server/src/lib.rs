//! Knotz Casino — the floor.
//!
//! One binary. It holds the wallet, the ledger and the table sessions, and it
//! serves the shell and every game as static files, which means the whole
//! casino is one origin: no CORS, no cookie-domain puzzle, and a game frame
//! that is same-origin with the floor hosting it.
//!
//! ------------------------------------------------------------------------
//! Why Rust for this particular job
//! ------------------------------------------------------------------------
//!
//! The floor is a ledger with a web server bolted to it. Both halves argue for
//! the same thing:
//!
//!   - **It must not be wrong about money.** Integer cents end to end, a type
//!     system that will not let a `None` balance be treated as zero, and no
//!     garbage collector deciding to pause between a debit and its ledger row.
//!   - **It must be boring to run.** One statically linked binary, a few
//!     megabytes of resident memory, and a SQLite file. There is no runtime to
//!     install, no interpreter version to pin, and the container that ships it
//!     is a base image plus one file.
//!   - **It has to hold sockets open.** Every seated player keeps a WebSocket
//!     for their balance. Tokio's per-task cost is measured in hundreds of
//!     bytes, so "every tab on the floor holds a socket" is a non-decision
//!     rather than a capacity plan.
//!
//! The honest alternative was Go, and it would have been fine. Rust wins here
//! on the first bullet: `Option`, `Result` and integer overflow checks turn
//! three classes of accounting bug into compile errors and panics in a test
//! rather than a wrong number in a wallet.

pub mod catalog;
pub mod config;
pub mod db;
pub mod error;
pub mod floor;
pub mod ids;
pub mod players;
pub mod sessions;
pub mod state;
pub mod wallet;

use axum::extract::Request;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::state::AppState;

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

pub fn router(state: AppState, config: &Config) -> Router {
    let api = Router::new()
        .route("/health", get(floor::health))
        .route("/audit", get(floor::audit))
        .route("/games", get(floor::games))
        .route("/ticker", get(floor::ticker))
        .route("/leaderboard", get(floor::leaderboard))
        .route("/ws", get(floor::socket))
        .route("/auth/guest", post(players::guest))
        .route("/auth/register", post(players::register))
        .route("/auth/login", post(players::login))
        .route("/auth/claim", post(players::claim))
        .route("/auth/logout", post(players::logout))
        .route("/me", get(players::me))
        .route("/me/comp", post(players::comp))
        .route("/me/ledger", get(players::ledger))
        .route("/sessions", get(sessions::history).post(sessions::seat))
        .route("/table", get(sessions::table))
        .route("/sessions/{id}/sync", post(sessions::sync))
        .route("/sessions/{id}/top-up", post(sessions::top_up))
        .route("/sessions/{id}/cash-out", post(sessions::cash_out))
        .route("/sessions/{id}/event", post(sessions::announce))
        .with_state(state);

    let mut app = Router::new().nest("/api/v1", api);

    // The games, one directory per slug, each a static export built with
    // `basePath: /games/<slug>`. `nest_service` strips the prefix, so the
    // directory layout on disk is exactly the slugs.
    if let Some(dir) = &config.games_dir {
        app = app.nest_service(
            "/games",
            ServeDir::new(dir).append_index_html_on_directories(true),
        );
        tracing::info!(dir = %dir.display(), "serving games");
    }

    // The shell at the root, with its own index as the fallback so a deep link
    // into the lobby survives a hard reload.
    if let Some(dir) = &config.shell_dir {
        let index = dir.join("index.html");
        let shell = ServeDir::new(dir)
            .append_index_html_on_directories(true)
            .fallback(ServeFile::new(index));
        app = app.fallback_service(shell);
        tracing::info!(dir = %dir.display(), "serving the shell");
    } else {
        app = app.fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                "The floor is running but no shell is built. \
                 Set KNOTZ_SHELL_DIR, or use the API at /api/v1.",
            )
        });
    }

    let mut app = app
        .layer(axum::middleware::from_fn(headers))
        // Brotli and gzip. The games ship a lot of JavaScript and a 52-card
        // PNG deck; the JavaScript compresses to about a quarter of itself and
        // the PNGs are already compressed, which the layer works out per
        // response from the content type.
        .layer(CompressionLayer::new().gzip(true).br(true))
        .layer(TraceLayer::new_for_http());

    // Same-origin is the shipped configuration and needs no CORS at all. The
    // layer only appears when somebody has deliberately split the shell off
    // onto its own host, and then only for the origins they named.
    if !config.allowed_origins.is_empty() {
        let origins: Vec<HeaderValue> = config
            .allowed_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        app = app.layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        );
    }

    app
}

/* ------------------------------------------------------------------ *
 * Headers
 * ------------------------------------------------------------------ */

/// Caching and the handful of security headers a framed casino needs.
///
/// The framing ones are the interesting part. A game is *meant* to be put in a
/// frame — by this floor and by nothing else — so `X-Frame-Options: DENY`
/// would break the casino and `ALLOWALL` would let anybody wrap our games in
/// their own chrome and take the bets. `SAMEORIGIN`, plus
/// `frame-ancestors 'self'` for browsers that read CSP instead, says exactly
/// the true thing: this page may be framed, by us.
async fn headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    let h = response.headers_mut();

    // Content-hashed assets never change under their own name.
    let immutable = path.contains("/_next/static/")
        || path.contains("/_next/image")
        || path.ends_with(".woff2");
    let is_api = path.starts_with("/api/");

    if immutable {
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else if is_api {
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    } else {
        // HTML, and the PNG card deck: revalidate, because a deploy changes
        // the HTML at the same URL and a stale shell pointing at a rebuilt
        // game is the one broken state worth designing away.
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=0, must-revalidate"),
        );
    }

    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    if !is_api {
        h.insert("X-Frame-Options", HeaderValue::from_static("SAMEORIGIN"));
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(
                // No remote origins at all: every asset, font and sound the
                // casino uses is built into it. `wasm-unsafe-eval` is for the
                // craps dice — Rapier is a WebAssembly rigid-body solver and
                // instantiating it needs it.
                "default-src 'self'; \
                 script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; \
                 style-src 'self' 'unsafe-inline'; \
                 img-src 'self' data: blob:; \
                 font-src 'self' data:; \
                 media-src 'self' data: blob:; \
                 connect-src 'self' ws: wss:; \
                 frame-src 'self'; \
                 frame-ancestors 'self'; \
                 base-uri 'self'; \
                 object-src 'none'",
            ),
        );
    }

    response
}
