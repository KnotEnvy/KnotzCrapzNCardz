//! Everything the floor reads from its environment, read once at boot.
//!
//! No config file. A casino that is one binary and one database file should be
//! configurable by the same things that start it, and every value here has a
//! default that produces a working floor on a laptop with no environment set
//! at all.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    /// SQLite URL. `sqlite://floor.db?mode=rwc` by default; a path is turned
    /// into one so `KNOTZ_DB=/data/floor.db` does the obvious thing.
    pub database_url: String,
    /// Where the built shell lives. Served at `/`.
    pub shell_dir: Option<PathBuf>,
    /// Where the built games live, one directory per slug. Served at
    /// `/games/<slug>/`.
    pub games_dir: Option<PathBuf>,
    /// What a new player finds in their wallet.
    pub signup_stake: i64,
    /// The daily comp, and the size of a bailout when a player is flat broke.
    pub comp_amount: i64,
    /// How long before a comp can be claimed again.
    pub comp_interval: Duration,
    /// How long a login lasts.
    pub token_ttl: Duration,
    /// Origins allowed to call the API from a browser. Empty means same-origin
    /// only, which is the shipped configuration: the floor serves the shell.
    pub allowed_origins: Vec<String>,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn env_i64(key: &str, default: i64) -> i64 {
    env(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        let port = env_i64("PORT", 8090).clamp(1, 65535) as u16;
        let host = env("HOST").unwrap_or_else(|| "0.0.0.0".to_string());
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .unwrap_or_else(|_| ([0, 0, 0, 0], port).into());

        // A bare path is a courtesy: `KNOTZ_DB=/data/floor.db` is what someone
        // writes in a compose file, and `mode=rwc` is what makes the first run
        // create the file instead of failing to open it.
        let database_url = match env("KNOTZ_DB") {
            Some(v) if v.starts_with("sqlite:") => v,
            Some(path) => format!("sqlite://{path}?mode=rwc"),
            None => "sqlite://floor.db?mode=rwc".to_string(),
        };

        Self {
            addr,
            database_url,
            shell_dir: env("KNOTZ_SHELL_DIR").map(PathBuf::from),
            games_dir: env("KNOTZ_GAMES_DIR").map(PathBuf::from),
            signup_stake: env_i64("KNOTZ_SIGNUP_STAKE", 500_000),
            comp_amount: env_i64("KNOTZ_COMP", 250_000),
            comp_interval: Duration::from_secs(
                env_i64("KNOTZ_COMP_INTERVAL_SECS", 8 * 60 * 60).max(0) as u64,
            ),
            token_ttl: Duration::from_secs(
                env_i64("KNOTZ_TOKEN_TTL_SECS", 90 * 24 * 60 * 60).max(60) as u64,
            ),
            allowed_origins: env("KNOTZ_ALLOWED_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}
