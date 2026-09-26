//! The floor itself: the catalog, the ticker, the leaderboard, and the live
//! socket that keeps a lobby honest without polling.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::catalog::{Game, CATALOG};
use crate::error::FloorResult;
use crate::players::{authenticate, Auth};
use crate::state::{AppState, FloorSignal};

/* ------------------------------------------------------------------ *
 * Catalog
 * ------------------------------------------------------------------ */

pub async fn games() -> Json<serde_json::Value> {
    let live: Vec<&Game> = CATALOG.iter().collect();
    Json(serde_json::json!({ "games": live }))
}

/* ------------------------------------------------------------------ *
 * Ticker
 * ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickerEntry {
    pub handle: String,
    pub game: String,
    pub kind: String,
    pub label: String,
    pub amount: Option<i64>,
    pub at: i64,
}

#[derive(Debug, Deserialize)]
pub struct TickerQuery {
    pub limit: Option<i64>,
}

/// The last few things worth shouting about. Public: no token needed, because
/// the lobby shows it before anybody signs in and a handle plus a win is not
/// private information on a floor whose whole point is being seen winning.
pub async fn ticker(
    State(state): State<AppState>,
    Query(q): Query<TickerQuery>,
) -> FloorResult<Json<serde_json::Value>> {
    let limit = q.limit.unwrap_or(24).clamp(1, 100);
    let rows: Vec<(String, String, String, String, Option<i64>, i64)> = sqlx::query_as(
        "SELECT handle, game, kind, label, amount, created_at \
         FROM floor_events ORDER BY id DESC LIMIT ?1",
    )
    .bind(limit)
    .fetch_all(state.pool())
    .await?;

    let entries: Vec<TickerEntry> = rows
        .into_iter()
        .map(|(handle, game, kind, label, amount, at)| TickerEntry {
            handle,
            game,
            kind,
            label,
            amount,
            at,
        })
        .collect();

    Ok(Json(serde_json::json!({ "entries": entries })))
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankrollRow {
    pub handle: String,
    pub tier: String,
    pub total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub handle: String,
    pub game: String,
    pub net: i64,
    pub rounds: i64,
    pub at: i64,
}

/// Two boards, because they answer different questions.
///
/// The bankroll board is who is ahead overall, which rewards sitting on a
/// stack. The session board is the best single sit-down, which rewards a night
/// that went right — and is the one a player can realistically aim at on their
/// first visit. A floor with only the first is a floor whose leaderboard is
/// decided in its first week.
pub async fn leaderboard(State(state): State<AppState>) -> FloorResult<Json<serde_json::Value>> {
    let bankrolls: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT p.handle, p.tier, \
                w.balance + COALESCE((SELECT SUM(chips) FROM sessions s \
                  WHERE s.player_id = p.id AND s.state = 'OPEN'), 0) AS total \
         FROM players p JOIN wallets w ON w.player_id = p.id \
         ORDER BY total DESC, p.created_at ASC LIMIT 12",
    )
    .fetch_all(state.pool())
    .await?;

    let sessions: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(
        "SELECT p.handle, s.game, s.chips - s.buy_in AS net, s.rounds, \
                COALESCE(s.closed_at, s.updated_at) \
         FROM sessions s JOIN players p ON p.id = s.player_id \
         WHERE s.rounds > 0 ORDER BY net DESC LIMIT 12",
    )
    .fetch_all(state.pool())
    .await?;

    Ok(Json(serde_json::json!({
        "bankrolls": bankrolls.into_iter().map(|(handle, tier, total)| BankrollRow { handle, tier, total }).collect::<Vec<_>>(),
        "sessions": sessions.into_iter().map(|(handle, game, net, rounds, at)| SessionRow { handle, game, net, rounds, at }).collect::<Vec<_>>(),
    })))
}

/* ------------------------------------------------------------------ *
 * The live feed
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct SocketQuery {
    pub token: Option<String>,
}

/// One socket per open tab, carrying two things: this player's balance
/// whenever it moves, and everybody's good news.
///
/// A socket rather than polling because the balance moves from somewhere the
/// lobby cannot see — a frame two components away, or another tab — and a
/// wallet that lags the game it is funding is the single most wrong-feeling
/// thing a casino shell can do.
pub async fn socket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<SocketQuery>,
) -> Response {
    /*
     * The token arrives in the query string because a browser WebSocket cannot
     * send an Authorization header. It is over TLS in any real deployment, so
     * the exposure is the URL appearing in a proxy log rather than on the
     * wire — the same trade every WebSocket API makes. An anonymous socket is
     * allowed and simply gets the public ticker, which is what the lobby needs
     * before anybody signs in.
     */
    let player_id = match q.token {
        Some(token) => authenticate(state.pool(), &token).await.ok().map(|p| p.id),
        None => None,
    };

    ws.on_upgrade(move |socket| pump(socket, state, player_id))
}

async fn pump(mut socket: WebSocket, state: AppState, player_id: Option<String>) {
    let mut feed = state.subscribe();

    // Say hello, so a client knows the socket is live rather than merely open.
    let hello = serde_json::json!({ "type": "open", "authenticated": player_id.is_some() });
    if socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            // The client closing, or a ping. Nothing else is expected from it:
            // this feed is one-directional by design, because a socket a
            // client can write commands to is a second API surface to secure.
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }

            signal = feed.recv() => {
                match signal {
                    Ok(signal) => {
                        let deliver = match &signal {
                            // A balance is addressed to one player.
                            FloorSignal::Wallet { player_id: owner, .. } =>
                                player_id.as_deref() == Some(owner.as_str()),
                            // A win is addressed to the floor.
                            FloorSignal::Ticker { .. } => true,
                        };
                        if !deliver { continue; }
                        let Ok(text) = serde_json::to_string(&signal) else { continue };
                        if socket.send(Message::Text(text.into())).await.is_err() { break; }
                    }
                    // Lagged: this client was too slow and missed messages.
                    // Every signal carries a full value rather than a delta, so
                    // the recovery is to tell the client to re-read and carry
                    // on rather than to close the socket.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let nudge = serde_json::json!({ "type": "resync" });
                        if socket.send(Message::Text(nudge.to_string().into())).await.is_err() { break; }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ *
 * Health and audit
 * ------------------------------------------------------------------ */

pub async fn health(State(state): State<AppState>) -> FloorResult<Json<serde_json::Value>> {
    // A health check that does not touch the database is a health check that
    // reports a floor with no books as healthy.
    let players: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM players")
        .fetch_one(state.pool())
        .await?;
    let open: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE state = 'OPEN'")
        .fetch_one(state.pool())
        .await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "games": CATALOG.len(),
        "players": players,
        "openTables": open,
    })))
}

/// The books, folded up and compared. Requires a token: it is a report about
/// every player, even though it names none of them beyond an id.
pub async fn audit(
    State(state): State<AppState>,
    Auth(_): Auth,
) -> FloorResult<Json<serde_json::Value>> {
    Ok(Json(crate::wallet::audit(state.pool()).await?))
}
