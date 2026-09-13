//! Shared state: the pool, the config, and the one broadcast channel every
//! live client listens on.

use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::config::Config;

/// What goes down the wire to a connected client.
///
/// Two kinds, and the difference matters: a `Wallet` signal is addressed to
/// one player and carries their balance, and a `Ticker` signal is addressed to
/// the whole floor and carries somebody's good news. The socket handler filters
/// the first by player id and forwards the second to everyone, which is why
/// both travel on one channel instead of one channel per player.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FloorSignal {
    #[serde(rename_all = "camelCase")]
    Wallet {
        player_id: String,
        balance: i64,
        /// Chips across every open table, so a client can render total assets
        /// without a second request.
        chips: i64,
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    Ticker {
        player_id: String,
        handle: String,
        game: String,
        kind: String,
        label: String,
        amount: Option<i64>,
        at: i64,
    },
}

pub struct Inner {
    pub pool: SqlitePool,
    pub config: Config,
    pub signals: broadcast::Sender<FloorSignal>,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

impl AppState {
    pub fn new(pool: SqlitePool, config: Config) -> Self {
        // Deep enough that a client which blocks for a moment does not miss a
        // jackpot; shallow enough that a client which has genuinely gone away
        // is dropped rather than buffered forever. A lagged receiver is told it
        // lagged and re-reads its state, which is the correct recovery for a
        // feed whose every message is a full value rather than a delta.
        let (signals, _) = broadcast::channel(256);
        Self(Arc::new(Inner {
            pool,
            config,
            signals,
        }))
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.0.pool
    }

    pub fn config(&self) -> &Config {
        &self.0.config
    }

    /// Fire and forget. No subscribers is the normal case, not an error.
    pub fn broadcast(&self, signal: FloorSignal) {
        let _ = self.0.signals.send(signal);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<FloorSignal> {
        self.0.signals.subscribe()
    }
}
