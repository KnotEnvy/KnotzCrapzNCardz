//! The connection pool, the migrations, and the pragmas that make SQLite
//! behave like a server database rather than a file.

use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

/// Milliseconds since the epoch. The one clock in the system.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub async fn connect(url: &str) -> anyhow_lite::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(url)
        .map_err(|e| format!("bad database url: {e}"))?
        .create_if_missing(true)
        // WAL is the difference between a SQLite that serialises every reader
        // behind every writer and one that does not. The floor's traffic is
        // overwhelmingly reads — a lobby poll, a wallet check — against rare,
        // tiny writes, which is precisely the shape WAL is for.
        .journal_mode(SqliteJournalMode::Wal)
        // NORMAL rather than FULL: with WAL this loses at most the last
        // transaction on an OS crash, and costs an fsync per commit rather
        // than two. For play money that is the right trade; a real-money
        // deployment should put this back to FULL and say so in its runbook.
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        // Without this, two concurrent writers produce SQLITE_BUSY rather than
        // waiting, and the loser is a player's cash-out.
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        // SQLite serialises writes whatever the pool says, so the pool exists
        // to keep concurrent *readers* from queueing. Five is comfortably more
        // than the floor's own concurrency and well under any file-descriptor
        // concern.
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .map_err(|e| format!("could not open the database: {e}"))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| format!("migrations failed: {e}"))?;

    Ok(pool)
}

/// A two-line stand-in for `anyhow`, so boot errors can carry a sentence
/// without the floor taking a dependency for five call sites.
pub mod anyhow_lite {
    pub type Result<T> = std::result::Result<T, String>;
}

/// Begin a transaction that is going to write.
///
/// This is not a convenience wrapper; it is a correctness fix, and the reason
/// is worth writing down because the failure it prevents is intermittent and
/// looks like something else.
///
/// SQLite's default `BEGIN` is *deferred*: it takes no lock until the first
/// statement, and a read-only lock if that statement is a read. A transaction
/// that then tries to write has to upgrade, and if another connection has the
/// write lock in the meantime SQLite does not wait — it returns `SQLITE_BUSY`
/// immediately, ignoring `busy_timeout`, because waiting would be a deadlock:
/// both sides hold a read lock and both want to write.
///
/// Every money-moving path in the floor has exactly that shape — read the
/// session, then write the wallet — so under two concurrent requests one of
/// them used to fail with a 500 that said nothing. `BEGIN IMMEDIATE` takes the
/// write lock up front, which means the second request *queues* on
/// `busy_timeout` and then proceeds, which is the behaviour a cash-out needs.
///
/// The cost is that two writers serialise. For a floor whose writes are a few
/// microseconds of integer arithmetic that is not a trade worth thinking about,
/// and it is what SQLite does under any concurrency anyway.
pub async fn write_tx(
    pool: &SqlitePool,
) -> Result<sqlx::Transaction<'static, sqlx::Sqlite>, sqlx::Error> {
    pool.begin_with("BEGIN IMMEDIATE").await
}
