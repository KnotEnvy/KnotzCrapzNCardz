//! Table sessions: the chips in front of a player at one game.
//!
//! ------------------------------------------------------------------------
//! The model, in one paragraph
//! ------------------------------------------------------------------------
//!
//! Sitting down at a game buys chips: the wallet is debited and the same
//! amount appears as the session's `chips`. While the player is seated, the
//! game reports its position and the floor writes it here — no ledger row, no
//! wallet movement, because nothing has crossed the cage. Standing up cashes
//! out: the chips move back to the wallet as one `CASH_OUT` row and the session
//! closes.
//!
//! So the ledger carries a session's story as exactly two entries, a buy-in
//! and a cash-out, whatever happened in between — which is what a real cage
//! records, and which keeps a ten-thousand-spin slot session from writing ten
//! thousand ledger rows to say the same thing.
//!
//! ------------------------------------------------------------------------
//! Why the game is trusted with its own payouts
//! ------------------------------------------------------------------------
//!
//! The floor does not re-derive a hand of blackjack or re-roll a pair of dice.
//! It could not: the engines that do that are the games, they are already
//! tested against their own exact mathematics, and moving them here would mean
//! rewriting all four and reproducing every figure.
//!
//! That is a deliberate trust boundary and it is worth being clear about where
//! it sits. This is a play-money floor, and the client is the authority on the
//! outcome of a round; the server is the authority on everything that crosses
//! the cage — what a buy-in cost, what a cash-out paid, what the wallet holds,
//! and the fact that a session cannot pay out twice. A real-money deployment
//! would move each engine behind this API and have the game render a result it
//! was given rather than one it computed; the protocol is shaped so that is a
//! change of who calls the engine, not a change of what the floor looks like.

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::catalog;
use crate::db::now_ms;
use crate::error::{FloorError, FloorResult};
use crate::ids::{id, token, token_hash};
use crate::players::{Auth, Player};
use crate::state::{AppState, FloorSignal};
use crate::wallet::{self, Movement, WalletView};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub game: String,
    pub chips: i64,
    pub buy_in: i64,
    pub wagered: i64,
    pub won: i64,
    pub rounds: i64,
    pub seq: i64,
    pub opened_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
    /// Chips minus everything ever bought in for. The session's bottom line.
    pub net: i64,
}

/// One session row, in the order `COLUMNS` selects it.
///
/// A tuple rather than a `FromRow` struct because `SessionView` is the shape
/// the API exposes and the row is an implementation detail of one SELECT; two
/// derived structs differing only in a computed field is more to keep in step,
/// not less. `COLUMNS` and this type change together or not at all.
type Row = (
    String,
    String,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    Option<i64>,
);

const COLUMNS: &str =
    "id, game, chips, buy_in, wagered, won, rounds, seq, opened_at, updated_at, closed_at";

/// `Row`, with the player's id, handle and tier joined on. Only the
/// session-token lookup needs it.
type SessionWithPlayerRow = (
    String,
    String,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    Option<i64>,
    String,
    String,
    String,
);

fn to_view(r: Row) -> SessionView {
    SessionView {
        id: r.0,
        game: r.1,
        chips: r.2,
        buy_in: r.3,
        wagered: r.4,
        won: r.5,
        rounds: r.6,
        seq: r.7,
        opened_at: r.8,
        updated_at: r.9,
        closed_at: r.10,
        net: r.2 - r.3,
    }
}

pub async fn open_for(pool: &SqlitePool, player_id: &str) -> FloorResult<Vec<SessionView>> {
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM sessions WHERE player_id = ?1 AND state = 'OPEN' \
         ORDER BY opened_at DESC"
    ))
    .bind(player_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(to_view).collect())
}

/* ------------------------------------------------------------------ *
 * Sitting down
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatRequest {
    pub game: String,
    /// What to buy in for. Omitted means the game's default.
    pub buy_in: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Seating {
    pub session: SessionView,
    /// Handed to the game in the handshake. Scoped to this session alone.
    pub token: String,
    pub wallet: WalletView,
    /// True when the player walked back to a table they had left chips on.
    pub resumed: bool,
    pub limits: Limits,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub min_bet: i64,
    pub max_bet: i64,
    pub denominations: Vec<i64>,
}

/// The largest buy-in the floor will take in one go.
///
/// Not a table limit and not a house rule — a guard against a fat finger or a
/// crafted request turning a five-hundred-dollar wallet into a
/// five-hundred-million-dollar table. The wallet check would refuse it anyway;
/// this refuses it with a sentence a person can read.
const MAX_BUY_IN: i64 = 100_000 * 100; // $100,000

pub async fn seat(
    State(state): State<AppState>,
    Auth(player): Auth,
    Json(body): Json<SeatRequest>,
) -> FloorResult<Json<Seating>> {
    let game = catalog::find(&body.game).ok_or(FloorError::NotFound("game"))?;
    if !game.live {
        return Err(FloorError::Conflict("that game is not open yet".into()));
    }

    let requested = body.buy_in.unwrap_or(game.default_buy_in);
    if requested <= 0 {
        return Err(FloorError::BadRequest("a buy-in has to be positive".into()));
    }
    if requested > MAX_BUY_IN {
        return Err(FloorError::BadRequest(
            "that is more than the floor will take at once".into(),
        ));
    }

    let issued = token();
    let now = now_ms();

    let mut tx = crate::db::write_tx(state.pool()).await?;

    // Is there a table already going? The partial unique index guarantees at
    // most one per game, so this is a lookup rather than a decision.
    let existing: Option<Row> = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM sessions WHERE player_id = ?1 AND game = ?2 AND state = 'OPEN'"
    ))
    .bind(&player.id)
    .bind(game.slug)
    .fetch_optional(&mut *tx)
    .await?;

    let (session, resumed) = match existing {
        Some(row) => {
            let mut current = to_view(row);
            /*
             * A resumed table keeps the chips that were on it. The only case
             * that needs money is a table the player busted out on and walked
             * away from: the session is open with nothing on it, and sitting
             * back down should buy in again rather than seat somebody at an
             * empty table and make them find the cashier.
             */
            if current.chips == 0 {
                wallet::debit(
                    &mut tx,
                    &player.id,
                    requested,
                    Movement::BuyIn,
                    wallet::Context {
                        session_id: Some(&current.id),
                        game: Some(game.slug),
                        memo: "buy-in",
                    },
                )
                .await?;
                sqlx::query(
                    "UPDATE sessions SET chips = chips + ?1, buy_in = buy_in + ?1, \
                     token_hash = ?2, updated_at = ?3 WHERE id = ?4",
                )
                .bind(requested)
                .bind(token_hash(&issued))
                .bind(now)
                .bind(&current.id)
                .execute(&mut *tx)
                .await?;
                current.chips += requested;
                current.buy_in += requested;
                current.net = current.chips - current.buy_in;
                current.updated_at = now;
            } else {
                // A fresh token every time the game is framed again: the old
                // one belonged to a frame that is gone.
                sqlx::query("UPDATE sessions SET token_hash = ?1, updated_at = ?2 WHERE id = ?3")
                    .bind(token_hash(&issued))
                    .bind(now)
                    .bind(&current.id)
                    .execute(&mut *tx)
                    .await?;
                current.updated_at = now;
            }
            (current, true)
        }
        None => {
            let session_id = id("ses");
            sqlx::query(
                "INSERT INTO sessions (id, player_id, game, state, chips, buy_in, token_hash, opened_at, updated_at) \
                 VALUES (?1, ?2, ?3, 'OPEN', 0, 0, ?4, ?5, ?5)",
            )
            .bind(&session_id)
            .bind(&player.id)
            .bind(game.slug)
            .bind(token_hash(&issued))
            .bind(now)
            .execute(&mut *tx)
            .await?;

            wallet::debit(
                &mut tx,
                &player.id,
                requested,
                Movement::BuyIn,
                wallet::Context {
                    session_id: Some(&session_id),
                    game: Some(game.slug),
                    memo: "buy-in",
                },
            )
            .await?;

            sqlx::query("UPDATE sessions SET chips = ?1, buy_in = ?1 WHERE id = ?2")
                .bind(requested)
                .bind(&session_id)
                .execute(&mut *tx)
                .await?;

            (
                to_view((
                    session_id,
                    game.slug.to_string(),
                    requested,
                    requested,
                    0,
                    0,
                    0,
                    0,
                    now,
                    now,
                    None,
                )),
                false,
            )
        }
    };

    tx.commit().await?;

    let wallet_view = wallet::view(state.pool(), &player.id).await?;
    state.broadcast(FloorSignal::Wallet {
        player_id: player.id.clone(),
        balance: wallet_view.balance,
        chips: wallet_view.chips,
        reason: if resumed { "resume" } else { "buy-in" }.into(),
    });

    Ok(Json(Seating {
        session,
        token: issued,
        wallet: wallet_view,
        resumed,
        limits: Limits {
            min_bet: game.min_bet,
            max_bet: game.max_bet,
            denominations: game.denominations.to_vec(),
        },
    }))
}

/* ------------------------------------------------------------------ *
 * Reporting a position
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub seq: i64,
    pub chips: i64,
    #[serde(default)]
    pub at_risk: i64,
    #[serde(default)]
    pub wagered: i64,
    #[serde(default)]
    pub won: i64,
    #[serde(default)]
    pub rounds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub session: SessionView,
    pub wallet: WalletView,
    /// False when the sync was a replay and nothing changed.
    pub applied: bool,
}

/// The game's position, written down.
///
/// No wallet movement and no ledger row: chips moving around a table are not
/// money crossing the cage. What this does own is the accounting identity —
/// `chips` here is what the cage will pay out — and the guard that makes the
/// endpoint safe to call twice.
pub async fn sync(
    State(state): State<AppState>,
    Auth(player): Auth,
    Path(session_id): Path<String>,
    Json(body): Json<SyncRequest>,
) -> FloorResult<Json<SyncResult>> {
    if body.chips < 0 || body.at_risk < 0 || body.wagered < 0 || body.won < 0 {
        return Err(FloorError::BadRequest(
            "a position cannot be negative".into(),
        ));
    }

    let now = now_ms();
    let mut tx = crate::db::write_tx(state.pool()).await?;
    let row = load_open(&mut tx, &session_id, &player.id).await?;
    let before = to_view(row);

    /*
     * `seq > sessions.seq` is the whole idempotency story. The floor's frame
     * may re-send a position after a reconnect, two frames of the same game
     * may briefly overlap during a reload, and a retried fetch may arrive
     * twice — all three are the same message and the second one must not
     * count. Comparing sequence rather than content is what makes a *repeated*
     * position (a player who bets and pushes, twice) different from a
     * *replayed* one.
     */
    if body.seq <= before.seq {
        tx.commit().await?;
        let wallet_view = wallet::view(state.pool(), &player.id).await?;
        return Ok(Json(SyncResult {
            session: before,
            wallet: wallet_view,
            applied: false,
        }));
    }

    // The game reports cumulative session totals; the wallet's lifetime
    // figures want the delta, and a game that restarted its own counters
    // must not push them backwards.
    let wagered_delta = (body.wagered - before.wagered).max(0);
    let won_delta = (body.won - before.won).max(0);

    sqlx::query(
        "UPDATE sessions SET chips = ?1, wagered = MAX(wagered, ?2), won = MAX(won, ?3), \
         rounds = MAX(rounds, ?4), seq = ?5, updated_at = ?6 WHERE id = ?7",
    )
    .bind(body.chips)
    .bind(body.wagered)
    .bind(body.won)
    .bind(body.rounds)
    .bind(body.seq)
    .bind(now)
    .bind(&session_id)
    .execute(&mut *tx)
    .await?;

    if wagered_delta > 0 || won_delta > 0 {
        sqlx::query(
            "UPDATE wallets SET lifetime_wagered = lifetime_wagered + ?1, \
             lifetime_won = lifetime_won + ?2, updated_at = ?3 WHERE player_id = ?4",
        )
        .bind(wagered_delta)
        .bind(won_delta)
        .bind(now)
        .bind(&player.id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let session = SessionView {
        chips: body.chips,
        wagered: before.wagered.max(body.wagered),
        won: before.won.max(body.won),
        rounds: before.rounds.max(body.rounds),
        seq: body.seq,
        updated_at: now,
        net: body.chips - before.buy_in,
        ..before
    };

    let wallet_view = wallet::view(state.pool(), &player.id).await?;
    state.broadcast(FloorSignal::Wallet {
        player_id: player.id.clone(),
        balance: wallet_view.balance,
        chips: wallet_view.chips,
        reason: "table".into(),
    });

    Ok(Json(SyncResult {
        session,
        wallet: wallet_view,
        applied: true,
    }))
}

/* ------------------------------------------------------------------ *
 * More chips, without leaving the table
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopUpRequest {
    pub amount: i64,
}

pub async fn top_up(
    State(state): State<AppState>,
    Auth(player): Auth,
    Path(session_id): Path<String>,
    Json(body): Json<TopUpRequest>,
) -> FloorResult<Json<SyncResult>> {
    if body.amount <= 0 {
        return Err(FloorError::BadRequest("a top-up has to be positive".into()));
    }
    if body.amount > MAX_BUY_IN {
        return Err(FloorError::BadRequest(
            "that is more than the floor will take at once".into(),
        ));
    }

    let now = now_ms();
    let mut tx = crate::db::write_tx(state.pool()).await?;
    let before = to_view(load_open(&mut tx, &session_id, &player.id).await?);

    wallet::debit(
        &mut tx,
        &player.id,
        body.amount,
        Movement::TopUp,
        wallet::Context {
            session_id: Some(&session_id),
            game: Some(&before.game),
            memo: "chips at the table",
        },
    )
    .await?;

    sqlx::query(
        "UPDATE sessions SET chips = chips + ?1, buy_in = buy_in + ?1, updated_at = ?2 WHERE id = ?3",
    )
    .bind(body.amount)
    .bind(now)
    .bind(&session_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let session = SessionView {
        chips: before.chips + body.amount,
        buy_in: before.buy_in + body.amount,
        updated_at: now,
        net: before.chips - before.buy_in,
        ..before
    };

    let wallet_view = wallet::view(state.pool(), &player.id).await?;
    state.broadcast(FloorSignal::Wallet {
        player_id: player.id.clone(),
        balance: wallet_view.balance,
        chips: wallet_view.chips,
        reason: "top-up".into(),
    });

    Ok(Json(SyncResult {
        session,
        wallet: wallet_view,
        applied: true,
    }))
}

/* ------------------------------------------------------------------ *
 * Standing up
 * ------------------------------------------------------------------ */

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashOutRequest {
    /// The game's final count, if it managed to send one.
    pub seq: Option<i64>,
    pub chips: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashOutResult {
    pub session: SessionView,
    pub wallet: WalletView,
    pub paid: i64,
}

/// Move the chips back to the wallet and close the table.
///
/// The `UPDATE ... WHERE state = 'OPEN'` is what makes a double cash-out
/// impossible: a second request finds no open row to close and gets a 409
/// rather than paying the same chips twice. That matters more than it looks —
/// the request is fired both by the leave button and by the game's own
/// cash-out reply, and either can be retried.
pub async fn cash_out(
    State(state): State<AppState>,
    Auth(player): Auth,
    Path(session_id): Path<String>,
    Json(body): Json<CashOutRequest>,
) -> FloorResult<Json<CashOutResult>> {
    let now = now_ms();
    let mut tx = crate::db::write_tx(state.pool()).await?;

    /*
     * Any state, not just open — because "you already cashed this table out"
     * is a different answer from "no such table", and this endpoint gets
     * called twice as a matter of course: the leave button fires it, and so
     * does the game's own `cashed-out` reply arriving a moment later. A 404
     * there would have the shell reporting a missing table for what is
     * actually the happy path.
     */
    let before = to_view(load_any(&mut tx, &session_id, &player.id).await?);
    if before.closed_at.is_some() {
        return Err(FloorError::Conflict(
            "that table has already been cashed out".into(),
        ));
    }

    // A final count from the game wins, if it is newer than what we hold.
    let mut chips = before.chips;
    if let (Some(seq), Some(reported)) = (body.seq, body.chips) {
        if reported >= 0 && seq > before.seq {
            chips = reported;
        }
    }

    let closed = sqlx::query(
        "UPDATE sessions SET chips = 0, state = 'CLOSED', closed_at = ?1, updated_at = ?1, \
         seq = MAX(seq, ?2) WHERE id = ?3 AND state = 'OPEN'",
    )
    .bind(now)
    .bind(body.seq.unwrap_or(0))
    .bind(&session_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if closed == 0 {
        return Err(FloorError::Conflict(
            "that table has already been cashed out".into(),
        ));
    }

    wallet::credit(
        &mut tx,
        &player.id,
        chips,
        Movement::CashOut,
        wallet::Context {
            session_id: Some(&session_id),
            game: Some(&before.game),
            memo: "cash-out",
        },
    )
    .await?;

    tx.commit().await?;

    let wallet_view = wallet::view(state.pool(), &player.id).await?;
    state.broadcast(FloorSignal::Wallet {
        player_id: player.id.clone(),
        balance: wallet_view.balance,
        chips: wallet_view.chips,
        reason: "cash-out".into(),
    });

    let session = SessionView {
        chips: 0,
        closed_at: Some(now),
        updated_at: now,
        net: chips - before.buy_in,
        ..before
    };

    Ok(Json(CashOutResult {
        session,
        wallet: wallet_view,
        paid: chips,
    }))
}

/* ------------------------------------------------------------------ *
 * The ticker
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRequest {
    pub kind: String,
    pub label: String,
    pub amount: Option<i64>,
}

pub async fn announce(
    State(state): State<AppState>,
    Auth(player): Auth,
    Path(session_id): Path<String>,
    Json(body): Json<EventRequest>,
) -> FloorResult<Json<serde_json::Value>> {
    if body.label.trim().is_empty() || body.label.chars().count() > 120 {
        return Err(FloorError::BadRequest("that is not a label".into()));
    }
    // The kind decides an icon on the ticker, so an unknown one is a bug in a
    // game rather than something to render.
    const KINDS: &[&str] = &["jackpot", "big-win", "feature", "milestone", "bust"];
    if !KINDS.contains(&body.kind.as_str()) {
        return Err(FloorError::BadRequest("unknown event kind".into()));
    }

    let game: Option<String> =
        sqlx::query_scalar("SELECT game FROM sessions WHERE id = ?1 AND player_id = ?2")
            .bind(&session_id)
            .bind(&player.id)
            .fetch_optional(state.pool())
            .await?;
    let game = game.ok_or(FloorError::NotFound("session"))?;

    let at = now_ms();
    sqlx::query(
        "INSERT INTO floor_events (player_id, handle, game, kind, label, amount, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&player.id)
    .bind(&player.handle)
    .bind(&game)
    .bind(&body.kind)
    .bind(body.label.trim())
    .bind(body.amount)
    .bind(at)
    .execute(state.pool())
    .await?;

    state.broadcast(FloorSignal::Ticker {
        player_id: player.id.clone(),
        handle: player.handle.clone(),
        game,
        kind: body.kind,
        label: body.label.trim().to_string(),
        amount: body.amount,
        at,
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

pub async fn history(
    State(state): State<AppState>,
    Auth(player): Auth,
) -> FloorResult<Json<serde_json::Value>> {
    let rows: Vec<Row> = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM sessions WHERE player_id = ?1 ORDER BY opened_at DESC LIMIT 50"
    ))
    .bind(&player.id)
    .fetch_all(state.pool())
    .await?;
    let sessions: Vec<SessionView> = rows.into_iter().map(to_view).collect();
    Ok(Json(serde_json::json!({ "sessions": sessions })))
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/// Load an open session that belongs to this player.
///
/// The `player_id` in the WHERE clause is the authorization check, and putting
/// it there rather than in a separate lookup is deliberate: there is no code
/// path that fetches a session and then remembers to ask whose it is.
async fn load_open(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session_id: &str,
    player_id: &str,
) -> FloorResult<Row> {
    let row: Option<Row> = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM sessions WHERE id = ?1 AND player_id = ?2 AND state = 'OPEN'"
    ))
    .bind(session_id)
    .bind(player_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.ok_or(FloorError::NotFound("open session"))
}

/// Load a session that belongs to this player, open or closed.
///
/// Used by the cash-out path, which needs to tell a closed table apart from a
/// table that never existed. Everything else wants `load_open`.
async fn load_any(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session_id: &str,
    player_id: &str,
) -> FloorResult<Row> {
    let row: Option<Row> = sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM sessions WHERE id = ?1 AND player_id = ?2"
    ))
    .bind(session_id)
    .bind(player_id)
    .fetch_optional(&mut **tx)
    .await?;
    row.ok_or(FloorError::NotFound("session"))
}

/// Resolve a session token to its session and player.
///
/// Not used by the shell, which authenticates as the player. It exists because
/// the protocol hands a game its own scoped token, and a future game — one that
/// talks to the floor directly rather than through the frame — authenticates
/// with it. Keeping the path implemented means the token in the handshake is a
/// real credential rather than a decorative field.
pub async fn by_session_token(
    pool: &SqlitePool,
    presented: &str,
) -> FloorResult<(SessionView, Player)> {
    let hash = token_hash(presented);
    let row: Option<SessionWithPlayerRow> = sqlx::query_as(
        "SELECT s.id, s.game, s.chips, s.buy_in, s.wagered, s.won, s.rounds, s.seq, \
                    s.opened_at, s.updated_at, s.closed_at, p.id, p.handle, p.tier \
             FROM sessions s JOIN players p ON p.id = s.player_id \
             WHERE s.token_hash = ?1 AND s.state = 'OPEN'",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;

    let r = row.ok_or(FloorError::Unauthorized)?;
    Ok((
        to_view((r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8, r.9, r.10)),
        Player {
            id: r.11,
            handle: r.12,
            tier: r.13,
        },
    ))
}

/* ------------------------------------------------------------------ *
 * The game's own view of its table
 * ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableView {
    pub session: SessionView,
    pub player: Player,
}

/// What a game sees when it asks the floor about itself, authenticating with
/// the session token it was handed in the handshake.
///
/// The shell does not need this — it already knows, because it opened the
/// session. It exists so that the token in the handshake is a working
/// credential rather than a decorative field, and so a game that outgrows the
/// frame (one with a server component of its own, or one that wants to
/// reconcile after a reload without asking its host) has a supported way to
/// check its position. A session token is scoped to one open table and is
/// worthless the moment that table closes.
pub async fn table(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> FloorResult<Json<TableView>> {
    let presented = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|raw| {
            raw.trim_start_matches("Bearer ")
                .trim_start_matches("bearer ")
                .trim()
                .to_string()
        })
        .ok_or(FloorError::Unauthorized)?;

    let (session, player) = by_session_token(state.pool(), &presented).await?;
    Ok(Json(TableView { session, player }))
}
