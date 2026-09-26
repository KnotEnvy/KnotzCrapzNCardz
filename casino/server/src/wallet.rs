//! The wallet, and the only two functions allowed to move it.
//!
//! ------------------------------------------------------------------------
//! How a race is prevented
//! ------------------------------------------------------------------------
//!
//! The dangerous shape is read-then-write: read the balance, decide it covers
//! the buy-in, write the difference. Two of those interleaved spend the same
//! money twice, and no amount of care in the handler above fixes it.
//!
//! So neither function reads first. A debit is a single conditional statement —
//!
//! ```text
//! UPDATE wallets SET balance = balance - ? WHERE player_id = ? AND balance >= ?
//! ```
//!
//! — which either moves the money or affects zero rows, and zero rows *is* the
//! answer "not enough". There is no window between the check and the write
//! because they are the same statement. The `balance >= 0` CHECK on the column
//! is the belt to that braces: a future statement that forgets the guard fails
//! the transaction rather than writing a negative wallet.
//!
//! Everything else — the ledger row, the lifetime counters — happens in the
//! same transaction, so a balance without its explanation cannot exist.

use serde::Serialize;
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::db::now_ms;
use crate::error::{FloorError, FloorResult};

/// Why money moved. Matches the CHECK constraint on `ledger.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Movement {
    Signup,
    Comp,
    BuyIn,
    CashOut,
    TopUp,
    Adjust,
}

impl Movement {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Signup => "SIGNUP",
            Self::Comp => "COMP",
            Self::BuyIn => "BUY_IN",
            Self::CashOut => "CASH_OUT",
            Self::TopUp => "TOP_UP",
            Self::Adjust => "ADJUST",
        }
    }

    /// Whether this is new money entering the casino, for the lifetime figure.
    fn is_deposit(self) -> bool {
        matches!(self, Self::Signup | Self::Comp)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletView {
    pub balance: i64,
    /// Chips sitting on open tables. Not spendable until cashed out.
    pub chips: i64,
    pub lifetime_in: i64,
    pub lifetime_wagered: i64,
    pub lifetime_won: i64,
}

impl WalletView {
    /// What the player is actually worth. The number the HUD leads with.
    pub fn total(&self) -> i64 {
        self.balance + self.chips
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: i64,
    pub amount: i64,
    pub balance_after: i64,
    pub kind: String,
    pub game: Option<String>,
    pub memo: String,
    pub at: i64,
}

/// Why a movement happened, for the ledger row that records it.
#[derive(Debug, Default)]
pub struct Context<'a> {
    pub session_id: Option<&'a str>,
    pub game: Option<&'a str>,
    pub memo: &'a str,
}

/// Take money out of the wallet. Returns the balance afterwards.
///
/// `FloorError::InsufficientFunds` when the wallet cannot cover it, carrying
/// both figures so the cashier can offer exactly the shortfall.
pub async fn debit(
    tx: &mut Transaction<'_, Sqlite>,
    player_id: &str,
    amount: i64,
    kind: Movement,
    ctx: Context<'_>,
) -> FloorResult<i64> {
    if amount <= 0 {
        return Err(FloorError::BadRequest(
            "an amount has to be positive".into(),
        ));
    }
    let at = now_ms();

    let moved = sqlx::query(
        "UPDATE wallets SET balance = balance - ?1, updated_at = ?2 \
         WHERE player_id = ?3 AND balance >= ?1",
    )
    .bind(amount)
    .bind(at)
    .bind(player_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();

    if moved == 0 {
        // Nothing was written, so the only question left is why: no wallet at
        // all, or a wallet that could not cover it.
        let balance: Option<i64> =
            sqlx::query_scalar("SELECT balance FROM wallets WHERE player_id = ?1")
                .bind(player_id)
                .fetch_optional(&mut **tx)
                .await?;
        return match balance {
            Some(balance) => Err(FloorError::InsufficientFunds {
                balance,
                needed: amount,
            }),
            None => Err(FloorError::NotFound("wallet")),
        };
    }

    let balance_after = read_balance(tx, player_id).await?;
    write_ledger(tx, player_id, -amount, balance_after, kind, ctx, at).await?;
    Ok(balance_after)
}

/// Put money into the wallet. Returns the balance afterwards.
pub async fn credit(
    tx: &mut Transaction<'_, Sqlite>,
    player_id: &str,
    amount: i64,
    kind: Movement,
    ctx: Context<'_>,
) -> FloorResult<i64> {
    if amount < 0 {
        return Err(FloorError::BadRequest(
            "an amount cannot be negative".into(),
        ));
    }
    let at = now_ms();

    // A zero cash-out is a real event — a player who lost the lot still stood
    // up from the table — and it belongs in the ledger so the session's story
    // is complete. It just does not touch the balance.
    if amount > 0 {
        let moved = sqlx::query(
            "UPDATE wallets SET balance = balance + ?1, \
             lifetime_in = lifetime_in + ?2, updated_at = ?3 WHERE player_id = ?4",
        )
        .bind(amount)
        .bind(if kind.is_deposit() { amount } else { 0 })
        .bind(at)
        .bind(player_id)
        .execute(&mut **tx)
        .await?
        .rows_affected();
        if moved == 0 {
            return Err(FloorError::NotFound("wallet"));
        }
    }

    let balance_after = read_balance(tx, player_id).await?;
    write_ledger(tx, player_id, amount, balance_after, kind, ctx, at).await?;
    Ok(balance_after)
}

async fn read_balance(tx: &mut Transaction<'_, Sqlite>, player_id: &str) -> FloorResult<i64> {
    sqlx::query_scalar("SELECT balance FROM wallets WHERE player_id = ?1")
        .bind(player_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(FloorError::NotFound("wallet"))
}

async fn write_ledger(
    tx: &mut Transaction<'_, Sqlite>,
    player_id: &str,
    amount: i64,
    balance_after: i64,
    kind: Movement,
    ctx: Context<'_>,
    at: i64,
) -> FloorResult<()> {
    sqlx::query(
        "INSERT INTO ledger (player_id, amount, balance_after, kind, session_id, game, memo, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(player_id)
    .bind(amount)
    .bind(balance_after)
    .bind(kind.as_str())
    .bind(ctx.session_id)
    .bind(ctx.game)
    .bind(ctx.memo)
    .bind(at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// The wallet plus the chips on every open table.
pub async fn view(pool: &SqlitePool, player_id: &str) -> FloorResult<WalletView> {
    let row: Option<(i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT balance, lifetime_in, lifetime_wagered, lifetime_won \
         FROM wallets WHERE player_id = ?1",
    )
    .bind(player_id)
    .fetch_optional(pool)
    .await?;

    let (balance, lifetime_in, lifetime_wagered, lifetime_won) =
        row.ok_or(FloorError::NotFound("wallet"))?;

    let chips: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(chips), 0) FROM sessions WHERE player_id = ?1 AND state = 'OPEN'",
    )
    .bind(player_id)
    .fetch_one(pool)
    .await?;

    Ok(WalletView {
        balance,
        chips,
        lifetime_in,
        lifetime_wagered,
        lifetime_won,
    })
}

/// One ledger row, in the order the SELECT below reads it.
type LedgerRow = (i64, i64, i64, String, Option<String>, String, i64);

pub async fn recent(
    pool: &SqlitePool,
    player_id: &str,
    limit: i64,
) -> FloorResult<Vec<LedgerEntry>> {
    let rows: Vec<LedgerRow> = sqlx::query_as(
        "SELECT id, amount, balance_after, kind, game, memo, created_at \
         FROM ledger WHERE player_id = ?1 ORDER BY id DESC LIMIT ?2",
    )
    .bind(player_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, amount, balance_after, kind, game, memo, at)| LedgerEntry {
                id,
                amount,
                balance_after,
                kind,
                game,
                memo,
                at,
            },
        )
        .collect())
}

/// Fold the ledger back up and compare it with the books.
///
/// This is the check the whole design exists to make possible, and it is an
/// endpoint rather than a test because the interesting version of it runs
/// against a database that has had players in it.
///
/// Three identities, and it is worth being precise about which ones hold,
/// because the tempting fourth one does not:
///
///   1. `sum(ledger.amount)` equals `wallet.balance`, exactly, for every
///      player. The balance is a cached fold of the ledger and every write to
///      one happens in the same transaction as the other.
///   2. Every `BUY_IN` and `TOP_UP` recorded against a session adds up to that
///      session's `buy_in`. This is what catches a buy-in that debited a
///      wallet and failed to reach a table, or the reverse.
///   3. A closed session holds no chips, and has been paid out exactly once.
///      Two `CASH_OUT` rows for one session would mean a table paid twice.
///
/// The one that does *not* hold, and must not be asserted: chips on a table
/// do not tie back to the ledger. A player who buys in for a thousand and runs
/// it to nine thousand has eight thousand dollars of chips the ledger has
/// never seen, because the game's engine created them and nothing crossed the
/// cage. That money becomes real to the books at cash-out, in one row, and
/// until then the session is the only record of it. Which is exactly how a
/// table float works, and exactly why the cage counts a rack rather than
/// deriving it.
pub async fn audit(pool: &SqlitePool) -> FloorResult<serde_json::Value> {
    let mut problems = Vec::new();

    // 1. Every wallet is its own ledger, folded up.
    let wallets: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT w.player_id, w.balance, \
                COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.player_id = w.player_id), 0) \
         FROM wallets w",
    )
    .fetch_all(pool)
    .await?;

    for (player_id, balance, ledger_sum) in &wallets {
        if balance != ledger_sum {
            problems.push(serde_json::json!({
                "kind": "balance",
                "playerId": player_id,
                "balance": balance,
                "ledgerSum": ledger_sum,
                "off": ledger_sum - balance,
            }));
        }
        if *balance < 0 {
            problems.push(serde_json::json!({
                "kind": "negative-balance",
                "playerId": player_id,
                "balance": balance,
            }));
        }
    }

    // 2 and 3. Every session's float ties to the rows that funded it, and a
    // closed one has been paid out once and holds nothing.
    let sessions: Vec<(String, String, i64, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT s.id, s.state, s.chips, s.buy_in, \
                COALESCE((SELECT -SUM(amount) FROM ledger l \
                          WHERE l.session_id = s.id AND l.kind IN ('BUY_IN','TOP_UP')), 0), \
                COALESCE((SELECT COUNT(*) FROM ledger l \
                          WHERE l.session_id = s.id AND l.kind = 'CASH_OUT'), 0), \
                COALESCE((SELECT SUM(amount) FROM ledger l \
                          WHERE l.session_id = s.id AND l.kind = 'CASH_OUT'), 0) \
         FROM sessions s",
    )
    .fetch_all(pool)
    .await?;

    for (id, state, chips, buy_in, funded, payouts, paid) in &sessions {
        if funded != buy_in {
            problems.push(serde_json::json!({
                "kind": "float",
                "sessionId": id,
                "buyIn": buy_in,
                "ledgerFunded": funded,
                "off": funded - buy_in,
            }));
        }
        if state == "CLOSED" {
            if *chips != 0 {
                problems.push(serde_json::json!({
                    "kind": "closed-with-chips", "sessionId": id, "chips": chips,
                }));
            }
            if *payouts != 1 {
                problems.push(serde_json::json!({
                    "kind": "payout-count", "sessionId": id, "cashOutRows": payouts, "paid": paid,
                }));
            }
        } else if *payouts != 0 {
            problems.push(serde_json::json!({
                "kind": "open-but-paid", "sessionId": id, "cashOutRows": payouts,
            }));
        }
    }

    Ok(serde_json::json!({
        "players": wallets.len(),
        "sessions": sessions.len(),
        "balanced": problems.is_empty(),
        "discrepancies": problems,
    }))
}
