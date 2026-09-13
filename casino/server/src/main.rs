//! Knotz Casino — the floor, as a process.
//!
//! Everything the floor *is* lives in the library beside this file; this is
//! the part that reads the environment, opens the books, binds a port and
//! knows how to stop politely. Splitting it that way is what lets the test
//! suite build the same router this does and drive real money through it
//! without a socket.

use knotz_floor::config::Config;
use knotz_floor::{catalog, db, router, state::AppState};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "knotz_floor=info,tower_http=warn,sqlx=warn".into()),
        )
        .with_target(false)
        .init();

    let config = Config::from_env();
    tracing::info!(
        addr = %config.addr,
        db = %redact(&config.database_url),
        "opening the floor"
    );

    let pool = match db::connect(&config.database_url).await {
        Ok(pool) => pool,
        Err(message) => {
            tracing::error!(%message, "the floor cannot open its books");
            std::process::exit(1);
        }
    };

    let state = AppState::new(pool, config.clone());
    let app = router(state, &config);

    let listener = match tokio::net::TcpListener::bind(config.addr).await {
        Ok(l) => l,
        Err(err) => {
            tracing::error!(%err, addr = %config.addr, "cannot bind");
            std::process::exit(1);
        }
    };

    tracing::info!(addr = %config.addr, games = catalog::CATALOG.len(), "the floor is open");

    if let Err(err) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
    {
        tracing::error!(%err, "the floor stopped badly");
        std::process::exit(1);
    }
}

/// A SQLite URL can carry a password in a future deployment; do not log one.
fn redact(url: &str) -> String {
    match url.split_once('?') {
        Some((head, _)) => format!("{head}?…"),
        None => url.to_string(),
    }
}

/// Close the doors on Ctrl-C or a container stop, and let in-flight requests
/// finish. A cash-out interrupted halfway is the one request worth waiting for.
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("last call — draining");
}
