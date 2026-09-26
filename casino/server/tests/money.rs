//! The money path, end to end, through the real router.
//!
//! These are not unit tests of the SQL. They drive the same `Router` the
//! binary serves, with the same migrations, and assert on the JSON a browser
//! would get — because every bug worth catching here lives in the seam between
//! two requests rather than inside one function. A double cash-out, a replayed
//! sync, a buy-in bigger than the wallet and a resumed table are all
//! two-request problems.
//!
//! The invariant every test finishes by checking is the one from
//! `wallet::audit`: every wallet is its own ledger folded up, every session's
//! float ties to the rows that funded it, and a closed table has been paid out
//! exactly once. If any test here can make one of those untrue, the design is
//! wrong and not just the code.

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use knotz_floor::config::Config;
use knotz_floor::state::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

const STAKE: i64 = 500_000; // $5,000
const COMP: i64 = 250_000; // $2,500

/// A floor with its own database file, torn down with the test.
struct Floor {
    app: Router,
    _dir: TempDir,
}

/// A temp directory that removes itself. Four lines rather than a dev
/// dependency; the whole need is "a path nobody else is using".
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!("knotz-floor-test-{tag}-{}", uuid_ish()));
        std::fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn uuid_ish() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{:x}", std::process::id())
}

async fn floor(tag: &str) -> Floor {
    let dir = TempDir::new(tag);
    let db = dir.0.join("floor.db");
    let url = format!("sqlite://{}?mode=rwc", db.display());

    let config = Config {
        addr: ([127, 0, 0, 1], 0).into(),
        database_url: url.clone(),
        shell_dir: None,
        games_dir: None,
        signup_stake: STAKE,
        comp_amount: COMP,
        comp_interval: Duration::from_secs(8 * 60 * 60),
        token_ttl: Duration::from_secs(3600),
        allowed_origins: Vec::new(),
    };

    let pool = knotz_floor::db::connect(&url)
        .await
        .expect("open the books");
    let state = AppState::new(pool, config.clone());
    Floor {
        app: knotz_floor::router(state, &config),
        _dir: dir,
    }
}

impl Floor {
    async fn send(
        &self,
        method: &str,
        uri: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            req = req.header("authorization", format!("Bearer {token}"));
        }
        let req = match body {
            Some(value) => req
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };

        let response = self.app.clone().oneshot(req).await.expect("routed");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .expect("body");
        let json = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or(Value::String(String::from_utf8_lossy(&bytes).to_string()))
        };
        (status, json)
    }

    async fn get(&self, uri: &str, token: &str) -> (StatusCode, Value) {
        self.send("GET", uri, Some(token), None).await
    }

    async fn post(&self, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
        self.send("POST", uri, Some(token), Some(body)).await
    }

    /// A fresh guest, and their token.
    async fn guest(&self) -> String {
        let (status, body) = self
            .send("POST", "/api/v1/auth/guest", None, Some(json!({})))
            .await;
        assert_eq!(status, StatusCode::OK, "guest sign-up: {body}");
        body["token"].as_str().expect("token").to_string()
    }

    /// The books must fold up. Called at the end of every test.
    async fn assert_balanced(&self, token: &str) {
        let (status, body) = self.get("/api/v1/audit", token).await;
        assert_eq!(status, StatusCode::OK, "audit: {body}");
        assert_eq!(
            body["balanced"],
            json!(true),
            "the ledger does not fold up to the wallets: {body}"
        );
    }
}

fn cents(body: &Value, path: &[&str]) -> i64 {
    let mut cursor = body;
    for key in path {
        cursor = &cursor[*key];
    }
    cursor
        .as_i64()
        .unwrap_or_else(|| panic!("expected a number at {path:?}, got {cursor}"))
}

/* ------------------------------------------------------------------ *
 * Signing up
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn a_guest_arrives_with_a_stake() {
    let floor = floor("signup").await;
    let token = floor.guest().await;

    let (status, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(cents(&me, &["wallet", "balance"]), STAKE);
    assert_eq!(cents(&me, &["wallet", "chips"]), 0);
    assert_eq!(cents(&me, &["total"]), STAKE);
    assert_eq!(me["player"]["tier"], json!("guest"));

    // And the stake is in the ledger, not just in the balance.
    let (_, ledger) = floor.get("/api/v1/me/ledger", &token).await;
    let entries = ledger["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["kind"], json!("SIGNUP"));
    assert_eq!(cents(&entries[0], &["amount"]), STAKE);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn an_unsigned_request_gets_nowhere() {
    let floor = floor("unauth").await;
    let (status, _) = floor.send("GET", "/api/v1/me", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _) = floor.get("/api/v1/me", "not-a-real-token").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/* ------------------------------------------------------------------ *
 * Buying in
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn sitting_down_moves_the_wallet_to_the_table() {
    let floor = floor("seat").await;
    let token = floor.guest().await;

    let (status, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{seating}");
    assert_eq!(cents(&seating, &["session", "chips"]), 100_000);
    assert_eq!(cents(&seating, &["session", "buyIn"]), 100_000);
    assert_eq!(cents(&seating, &["wallet", "balance"]), STAKE - 100_000);
    assert_eq!(seating["resumed"], json!(false));
    assert!(seating["token"].as_str().is_some_and(|t| t.len() >= 32));

    // The player is no poorer: the money is on the table, and `total` says so.
    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["total"]), STAKE);
    assert_eq!(cents(&me, &["wallet", "chips"]), 100_000);
    assert_eq!(me["openTables"].as_array().expect("tables").len(), 1);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn the_wallet_refuses_what_it_cannot_cover() {
    let floor = floor("broke").await;
    let token = floor.guest().await;

    let (status, body) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": STAKE + 1 }),
        )
        .await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED, "{body}");
    assert_eq!(body["error"], json!("insufficient_funds"));
    // The cashier needs both figures to offer the difference.
    assert_eq!(cents(&body, &["balance"]), STAKE);
    assert_eq!(cents(&body, &["needed"]), STAKE + 1);

    // And nothing happened.
    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "balance"]), STAKE);
    assert_eq!(me["openTables"].as_array().expect("tables").len(), 0);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn an_unknown_game_is_not_on_the_floor() {
    let floor = floor("nogame").await;
    let token = floor.guest().await;
    let (status, _) = floor
        .post("/api/v1/sessions", &token, json!({ "game": "roulette" }))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn walking_back_to_a_table_resumes_it_without_paying_twice() {
    let floor = floor("resume").await;
    let token = floor.guest().await;

    let (_, first) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "blackjack", "buyIn": 200_000 }),
        )
        .await;
    let session = first["session"]["id"].as_str().unwrap().to_string();

    // Won a bit while seated.
    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 1, "chips": 260_000, "atRisk": 0, "wagered": 40_000, "won": 100_000, "rounds": 8 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    // Closed the tab, came back.
    let (status, again) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "blackjack", "buyIn": 200_000 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["resumed"], json!(true));
    assert_eq!(
        again["session"]["id"],
        json!(session),
        "a second table was opened"
    );
    // The chips that were on the table are still on it, and the wallet was not
    // charged again.
    assert_eq!(cents(&again, &["session", "chips"]), 260_000);
    assert_eq!(cents(&again, &["session", "buyIn"]), 200_000);
    assert_eq!(cents(&again, &["wallet", "balance"]), STAKE - 200_000);
    // ...and it is a new token, because the old frame is gone.
    assert_ne!(again["token"], first["token"]);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn sitting_back_down_at_a_table_you_busted_out_on_buys_in_again() {
    let floor = floor("rebuy").await;
    let token = floor.guest().await;

    let (_, first) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "dragons-shrine", "buyIn": 150_000 }),
        )
        .await;
    let session = first["session"]["id"].as_str().unwrap().to_string();

    // Lost the lot.
    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 1, "chips": 0, "wagered": 150_000, "won": 0, "rounds": 300 }),
        )
        .await;

    let (status, again) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "dragons-shrine", "buyIn": 100_000 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["resumed"], json!(true));
    assert_eq!(cents(&again, &["session", "chips"]), 100_000);
    // Both buy-ins are on the session, so `net` is honest about the hole.
    assert_eq!(cents(&again, &["session", "buyIn"]), 250_000);
    assert_eq!(cents(&again, &["session", "net"]), -150_000);
    assert_eq!(cents(&again, &["wallet", "balance"]), STAKE - 250_000);

    floor.assert_balanced(&token).await;
}

/* ------------------------------------------------------------------ *
 * Syncing a position
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn a_replayed_sync_changes_nothing() {
    let floor = floor("replay").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();
    let sync = format!("/api/v1/sessions/{session}/sync");

    let position =
        json!({ "seq": 7, "chips": 140_000, "wagered": 30_000, "won": 70_000, "rounds": 5 });

    let (status, first) = floor.post(&sync, &token, position.clone()).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["applied"], json!(true));
    assert_eq!(cents(&first, &["session", "chips"]), 140_000);

    // The same message again — a retried fetch, or two frames of the same game
    // overlapping through a reload.
    let (status, second) = floor.post(&sync, &token, position).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["applied"], json!(false));
    assert_eq!(cents(&second, &["session", "chips"]), 140_000);

    // An older position loses too, even though its numbers are different.
    let (_, stale) = floor
        .post(
            &sync,
            &token,
            json!({ "seq": 3, "chips": 10, "wagered": 1, "won": 0, "rounds": 1 }),
        )
        .await;
    assert_eq!(stale["applied"], json!(false));
    assert_eq!(cents(&stale, &["session", "chips"]), 140_000);

    // The lifetime figures counted the round once, not three times.
    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "lifetimeWagered"]), 30_000);
    assert_eq!(cents(&me, &["wallet", "lifetimeWon"]), 70_000);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn a_sync_writes_no_ledger_rows() {
    let floor = floor("noledger").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": 50_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();
    let sync = format!("/api/v1/sessions/{session}/sync");

    for seq in 1..=25 {
        floor
            .post(
                &sync,
                &token,
                json!({ "seq": seq, "chips": 50_000 + seq * 100, "wagered": seq * 500, "won": seq * 600, "rounds": seq }),
            )
            .await;
    }

    // Two rows for the whole session so far: the sign-up stake and the buy-in.
    // Chips moving around a table are not money crossing the cage.
    let (_, ledger) = floor.get("/api/v1/me/ledger", &token).await;
    let entries = ledger["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 2, "a sync wrote to the ledger: {ledger}");

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn another_players_table_is_not_yours_to_sync() {
    let floor = floor("tenant").await;
    let mine = floor.guest().await;
    let theirs = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &mine,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &theirs,
            json!({ "seq": 1, "chips": 9_000_000 }),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "one player synced another's table"
    );

    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &theirs,
            json!({}),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "one player cashed out another's table"
    );

    floor.assert_balanced(&mine).await;
}

#[tokio::test]
async fn a_negative_position_is_refused() {
    let floor = floor("negative").await;
    let token = floor.guest().await;
    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 1, "chips": -500 }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    floor.assert_balanced(&token).await;
}

/* ------------------------------------------------------------------ *
 * Cashing out
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn cashing_out_pays_the_table_into_the_wallet_once() {
    let floor = floor("cashout").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "three-card-poker", "buyIn": 75_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 4, "chips": 91_000, "wagered": 20_000, "won": 36_000, "rounds": 12 }),
        )
        .await;

    let (status, out) = floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &token,
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert_eq!(cents(&out, &["paid"]), 91_000);
    assert_eq!(cents(&out, &["wallet", "balance"]), STAKE - 75_000 + 91_000);
    assert_eq!(cents(&out, &["wallet", "chips"]), 0);
    assert_eq!(cents(&out, &["session", "net"]), 16_000);

    // Doing it again pays nothing. This is the one that matters: the leave
    // button and the game's own cash-out reply both fire this request.
    let (status, again) = floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &token,
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");

    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "balance"]), STAKE - 75_000 + 91_000);
    assert_eq!(me["openTables"].as_array().expect("tables").len(), 0);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn a_final_count_from_the_game_wins_if_it_is_newer() {
    let floor = floor("finalcount").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "blackjack", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 2, "chips": 105_000, "wagered": 10_000, "won": 15_000, "rounds": 2 }),
        )
        .await;

    // The last hand paid after the final sync went out, which is exactly what
    // the game's `cashed-out` message is for.
    let (status, out) = floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &token,
            json!({ "seq": 3, "chips": 120_000 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert_eq!(cents(&out, &["paid"]), 120_000);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn a_stale_final_count_does_not_overwrite_the_floors() {
    let floor = floor("stalecount").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "blackjack", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 9, "chips": 130_000, "wagered": 10_000, "won": 40_000, "rounds": 3 }),
        )
        .await;

    // An out-of-order message claiming less than the floor already holds.
    let (_, out) = floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &token,
            json!({ "seq": 4, "chips": 1_000 }),
        )
        .await;
    assert_eq!(
        cents(&out, &["paid"]),
        130_000,
        "a stale count short-paid the player"
    );

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn a_player_who_lost_the_lot_still_stands_up_cleanly() {
    let floor = floor("busted").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "dragons-shrine", "buyIn": 200_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 1, "chips": 0, "wagered": 200_000, "won": 0, "rounds": 400 }),
        )
        .await;

    let (status, out) = floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &token,
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert_eq!(cents(&out, &["paid"]), 0);
    assert_eq!(cents(&out, &["wallet", "balance"]), STAKE - 200_000);

    // The zero cash-out is still in the ledger, so the session has an ending.
    let (_, ledger) = floor.get("/api/v1/me/ledger", &token).await;
    let entries = ledger["entries"].as_array().expect("entries");
    assert_eq!(entries[0]["kind"], json!("CASH_OUT"));
    assert_eq!(cents(&entries[0], &["amount"]), 0);

    floor.assert_balanced(&token).await;
}

/* ------------------------------------------------------------------ *
 * Top-ups
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn a_top_up_moves_more_chips_to_a_live_table() {
    let floor = floor("topup").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    let (status, topped) = floor
        .post(
            &format!("/api/v1/sessions/{session}/top-up"),
            &token,
            json!({ "amount": 50_000 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{topped}");
    assert_eq!(cents(&topped, &["session", "chips"]), 150_000);
    assert_eq!(cents(&topped, &["session", "buyIn"]), 150_000);
    assert_eq!(cents(&topped, &["wallet", "balance"]), STAKE - 150_000);

    // A top-up bigger than the wallet is refused, and changes nothing.
    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/top-up"),
            &token,
            json!({ "amount": STAKE }),
        )
        .await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);

    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "balance"]), STAKE - 150_000);
    assert_eq!(cents(&me, &["total"]), STAKE);

    floor.assert_balanced(&token).await;
}

/* ------------------------------------------------------------------ *
 * The comp
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn the_cage_comps_a_broke_player_and_then_makes_them_wait() {
    let floor = floor("comp").await;
    let token = floor.guest().await;

    // Lose everything: buy in for the lot and bust.
    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": STAKE }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();
    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &token,
            json!({ "seq": 1, "chips": 0, "wagered": STAKE, "won": 0, "rounds": 40 }),
        )
        .await;
    floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &token,
            json!({}),
        )
        .await;

    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["total"]), 0);
    assert_eq!(me["compReadyAt"], Value::Null, "a comp should be waiting");

    let (status, comped) = floor.post("/api/v1/me/comp", &token, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{comped}");
    assert_eq!(cents(&comped, &["granted"]), COMP);
    assert_eq!(cents(&comped, &["wallet", "balance"]), COMP);

    // Not twice: the timer is the only thing between this and an infinite
    // bankroll.
    let (status, refused) = floor.post("/api/v1/me/comp", &token, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(cents(&comped, &["wallet", "balance"]), COMP);

    floor.assert_balanced(&token).await;
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn a_guest_can_claim_their_wallet_without_losing_it() {
    let floor = floor("claim").await;
    let token = floor.guest().await;

    floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;

    let (status, claimed) = floor
        .post(
            "/api/v1/auth/claim",
            &token,
            json!({ "handle": "Knotz_VIP", "password": "a-long-enough-password" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{claimed}");
    assert_eq!(claimed["player"]["tier"], json!("member"));
    assert_eq!(claimed["player"]["handle"], json!("Knotz_VIP"));
    // Same wallet, same table.
    assert_eq!(cents(&claimed, &["wallet", "balance"]), STAKE - 100_000);
    assert_eq!(cents(&claimed, &["wallet", "chips"]), 100_000);

    // And the password now works.
    let (status, signed_in) = floor
        .send(
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "handle": "knotz_vip", "password": "a-long-enough-password" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{signed_in}");
    assert_eq!(cents(&signed_in, &["wallet", "chips"]), 100_000);

    let (status, _) = floor
        .send(
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "handle": "Knotz_VIP", "password": "the-wrong-password" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    floor.assert_balanced(&token).await;
}

#[tokio::test]
async fn a_handle_is_taken_only_once() {
    let floor = floor("handles").await;

    let (status, _) = floor
        .send(
            "POST",
            "/api/v1/auth/register",
            None,
            Some(json!({ "handle": "HighRoller", "password": "eight-or-more" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    // Same handle, different capitals.
    let (status, body) = floor
        .send(
            "POST",
            "/api/v1/auth/register",
            None,
            Some(json!({ "handle": "highroller", "password": "eight-or-more" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn a_handle_has_to_be_a_handle() {
    let floor = floor("badhandle").await;
    for handle in [
        "a",
        "way-too-long-a-handle-for-a-ticker",
        "drop table players",
    ] {
        let (status, _) = floor
            .send(
                "POST",
                "/api/v1/auth/guest",
                None,
                Some(json!({ "handle": handle })),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "accepted {handle:?}");
    }
}

#[tokio::test]
async fn logging_out_revokes_the_token() {
    let floor = floor("logout").await;
    let token = floor.guest().await;

    let (status, _) = floor.post("/api/v1/auth/logout", &token, json!({})).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = floor.get("/api/v1/me", &token).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/* ------------------------------------------------------------------ *
 * The floor
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn the_catalog_is_what_the_shell_needs_to_draw_a_tile() {
    let floor = floor("catalog").await;
    let (status, body) = floor.send("GET", "/api/v1/games", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let games = body["games"].as_array().expect("games");
    assert_eq!(games.len(), 4);

    for game in games {
        for key in [
            "slug",
            "title",
            "tagline",
            "kind",
            "path",
            "accent",
            "accentAlt",
            "edgeLabel",
        ] {
            assert!(
                game[key].as_str().is_some_and(|s| !s.is_empty()),
                "{key} missing on {game}"
            );
        }
        assert!(cents(game, &["defaultBuyIn"]) > 0);
        assert!(cents(game, &["minBet"]) > 0);
        assert!(cents(game, &["maxBet"]) >= cents(game, &["minBet"]));
        assert!(!game["denominations"].as_array().expect("denoms").is_empty());
        assert!(game["highlights"].as_array().expect("highlights").len() >= 3);
        // Every path is where the floor actually serves that game.
        assert_eq!(
            game["path"],
            json!(format!("/games/{}/", game["slug"].as_str().unwrap()))
        );
    }
}

#[tokio::test]
async fn a_win_reaches_the_ticker() {
    let floor = floor("ticker").await;
    let token = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &token,
            json!({ "game": "dragons-shrine", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();

    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/event"),
            &token,
            json!({ "kind": "jackpot", "label": "GRAND on Dragon's Shrine", "amount": 5_000_000 }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = floor.send("GET", "/api/v1/ticker", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let entries = body["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["kind"], json!("jackpot"));
    assert_eq!(cents(&entries[0], &["amount"]), 5_000_000);

    // An event kind nobody can render is a bug in a game, not a row.
    let (status, _) = floor
        .post(
            &format!("/api/v1/sessions/{session}/event"),
            &token,
            json!({ "kind": "something-made-up", "label": "hello" }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn the_leaderboard_ranks_bankrolls_and_sessions() {
    let floor = floor("board").await;

    let winner = floor.guest().await;
    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &winner,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    let session = seating["session"]["id"].as_str().unwrap().to_string();
    floor
        .post(
            &format!("/api/v1/sessions/{session}/sync"),
            &winner,
            json!({ "seq": 1, "chips": 900_000, "wagered": 100_000, "won": 900_000, "rounds": 20 }),
        )
        .await;

    let _loser = floor.guest().await;

    let (status, body) = floor.send("GET", "/api/v1/leaderboard", None, None).await;
    assert_eq!(status, StatusCode::OK);

    let bankrolls = body["bankrolls"].as_array().expect("bankrolls");
    assert_eq!(bankrolls.len(), 2);
    // Chips on an open table count towards a bankroll; that is what the player
    // is worth.
    assert_eq!(cents(&bankrolls[0], &["total"]), STAKE - 100_000 + 900_000);

    let sessions = body["sessions"].as_array().expect("sessions");
    assert_eq!(
        sessions.len(),
        1,
        "a session with no rounds should not rank"
    );
    assert_eq!(cents(&sessions[0], &["net"]), 800_000);
}

#[tokio::test]
async fn a_game_can_ask_the_floor_about_its_own_table() {
    let floor = floor("selfcheck").await;
    let player = floor.guest().await;

    let (_, seating) = floor
        .post(
            "/api/v1/sessions",
            &player,
            json!({ "game": "craps", "buyIn": 100_000 }),
        )
        .await;
    let session_token = seating["token"].as_str().unwrap().to_string();

    let (status, body) = floor.get("/api/v1/table", &session_token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["session"]["game"], json!("craps"));
    assert_eq!(cents(&body, &["session", "chips"]), 100_000);

    // A session token is not a player token: it cannot reach the wallet.
    let (status, _) = floor.get("/api/v1/me", &session_token).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // ...and it dies with the table.
    let session = seating["session"]["id"].as_str().unwrap().to_string();
    floor
        .post(
            &format!("/api/v1/sessions/{session}/cash-out"),
            &player,
            json!({}),
        )
        .await;
    let (status, _) = floor.get("/api/v1/table", &session_token).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn health_says_what_is_on_the_floor() {
    let floor = floor("health").await;
    let (status, body) = floor.send("GET", "/api/v1/health", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], json!(true));
    assert_eq!(cents(&body, &["games"]), 4);
}

/* ------------------------------------------------------------------ *
 * The whole thing at once
 * ------------------------------------------------------------------ */

#[tokio::test]
async fn one_bankroll_carries_across_every_game_on_the_floor() {
    let floor = floor("crawl").await;
    let token = floor.guest().await;

    // Sit down at all four, a quarter of the stake at each.
    let mut tables = Vec::new();
    for game in ["craps", "blackjack", "three-card-poker", "dragons-shrine"] {
        let (status, seating) = floor
            .post(
                "/api/v1/sessions",
                &token,
                json!({ "game": game, "buyIn": 100_000 }),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "seating at {game}: {seating}");
        tables.push(seating["session"]["id"].as_str().unwrap().to_string());
    }

    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "balance"]), STAKE - 400_000);
    assert_eq!(cents(&me, &["wallet", "chips"]), 400_000);
    assert_eq!(
        cents(&me, &["total"]),
        STAKE,
        "the bankroll changed by sitting down"
    );
    assert_eq!(me["openTables"].as_array().expect("tables").len(), 4);

    // Two win, two lose, by different amounts.
    let outcomes = [140_000i64, 60_000, 175_000, 0];
    for (session, chips) in tables.iter().zip(outcomes) {
        floor
            .post(
                &format!("/api/v1/sessions/{session}/sync"),
                &token,
                json!({ "seq": 1, "chips": chips, "wagered": 100_000, "won": chips, "rounds": 10 }),
            )
            .await;
    }

    let expected_chips: i64 = outcomes.iter().sum();
    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "chips"]), expected_chips);
    assert_eq!(cents(&me, &["total"]), STAKE - 400_000 + expected_chips);

    // Cash out everywhere. The wallet ends up with exactly what the tables held.
    for session in &tables {
        let (status, _) = floor
            .post(
                &format!("/api/v1/sessions/{session}/cash-out"),
                &token,
                json!({}),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
    }

    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(
        cents(&me, &["wallet", "balance"]),
        STAKE - 400_000 + expected_chips
    );
    assert_eq!(cents(&me, &["wallet", "chips"]), 0);
    assert_eq!(me["openTables"].as_array().expect("tables").len(), 0);
    assert_eq!(cents(&me, &["wallet", "lifetimeWagered"]), 400_000);

    // Nine ledger rows: one stake, four buy-ins, four cash-outs.
    let (_, ledger) = floor.get("/api/v1/me/ledger", &token).await;
    assert_eq!(ledger["entries"].as_array().expect("entries").len(), 9);

    floor.assert_balanced(&token).await;
}

/// Concurrency, the only way it actually bites: two buy-ins racing for the
/// same money.
///
/// Both requests see a wallet that covers them. Only one may win, and the
/// other must get a 402 rather than a negative wallet — which is what the
/// conditional UPDATE in `wallet::debit` is for. This test is the reason that
/// function does not read the balance first.
#[tokio::test]
async fn two_buy_ins_racing_for_the_last_chips_cannot_both_win() {
    let floor = floor("race").await;
    let token = floor.guest().await;

    // Two different games, so the one-open-table-per-game index is not what
    // decides this. Each wants three fifths of the wallet: either alone fits,
    // both together do not.
    let each = STAKE * 3 / 5;

    let a = floor.post(
        "/api/v1/sessions",
        &token,
        json!({ "game": "craps", "buyIn": each }),
    );
    let b = floor.post(
        "/api/v1/sessions",
        &token,
        json!({ "game": "blackjack", "buyIn": each }),
    );
    let (first, second) = tokio::join!(a, b);

    let statuses = [first.0, second.0];
    let won = statuses.iter().filter(|s| **s == StatusCode::OK).count();
    let refused = statuses
        .iter()
        .filter(|s| **s == StatusCode::PAYMENT_REQUIRED)
        .count();
    assert_eq!(
        (won, refused),
        (1, 1),
        "both buy-ins were served: {:?} / {:?}",
        first.1,
        second.1
    );

    let (_, me) = floor.get("/api/v1/me", &token).await;
    assert_eq!(cents(&me, &["wallet", "balance"]), STAKE - each);
    assert!(cents(&me, &["wallet", "balance"]) >= 0);
    assert_eq!(cents(&me, &["total"]), STAKE);

    floor.assert_balanced(&token).await;
}
