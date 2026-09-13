//! Players: who they are, how they prove it, and the wallet they get on the
//! way in.

use axum::extract::{FromRequestParts, Query, State};
use axum::http::request::Parts;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::db::now_ms;
use crate::error::{FloorError, FloorResult};
use crate::ids::{id, token, token_hash};
use crate::state::AppState;
use crate::wallet::{self, Movement, WalletView};

/* ------------------------------------------------------------------ *
 * The player
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub handle: String,
    pub tier: String,
}

/// A request that carries a valid bearer token.
///
/// Written as an extractor rather than a helper because that is what makes an
/// unauthenticated handler impossible to write by accident: a handler either
/// takes an `Auth` and has a player, or does not take one and cannot reach a
/// wallet.
pub struct Auth(pub Player);

impl FromRequestParts<AppState> for Auth {
    type Rejection = FloorError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let presented = bearer(parts).ok_or(FloorError::Unauthorized)?;
        let player = authenticate(state.pool(), &presented).await?;
        Ok(Auth(player))
    }
}

/// The token on a request, from the header or — for a WebSocket, which cannot
/// carry one — from the query string.
fn bearer(parts: &Parts) -> Option<String> {
    if let Some(value) = parts.headers.get(axum::http::header::AUTHORIZATION) {
        let raw = value.to_str().ok()?;
        if let Some(rest) = raw.strip_prefix("Bearer ") {
            return Some(rest.trim().to_string());
        }
        if let Some(rest) = raw.strip_prefix("bearer ") {
            return Some(rest.trim().to_string());
        }
    }
    let query = parts.uri.query()?;
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("token=") {
            let decoded = v.replace('+', " ");
            return Some(decoded);
        }
    }
    None
}

/// Resolve a token to a player, and refuse an expired one.
pub async fn authenticate(pool: &SqlitePool, presented: &str) -> FloorResult<Player> {
    if presented.is_empty() || presented.len() > 200 {
        return Err(FloorError::Unauthorized);
    }
    let hash = token_hash(presented);
    let now = now_ms();

    let row: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT p.id, p.handle, p.tier, t.expires_at \
         FROM tokens t JOIN players p ON p.id = t.player_id \
         WHERE t.token_hash = ?1",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;

    let (id, handle, tier, expires_at) = row.ok_or(FloorError::Unauthorized)?;
    if expires_at <= now {
        // Tidy up on the way past. An expired token is dead weight and this is
        // the only moment anybody looks at it.
        let _ = sqlx::query("DELETE FROM tokens WHERE token_hash = ?1")
            .bind(&hash)
            .execute(pool)
            .await;
        return Err(FloorError::Unauthorized);
    }

    // Cheap, and it is what makes "who is on the floor" answerable.
    let _ = sqlx::query("UPDATE players SET last_seen_at = ?1 WHERE id = ?2")
        .bind(now)
        .bind(&id)
        .execute(pool)
        .await;

    Ok(Player { id, handle, tier })
}

/* ------------------------------------------------------------------ *
 * Handles
 * ------------------------------------------------------------------ */

const HANDLE_MAX: usize = 20;

/// Letters, digits, and the two separators a person actually types.
///
/// Narrow on purpose: a handle goes on the ticker and the leaderboard, which
/// means it is rendered next to other players' names, and the cheapest way to
/// never have to think about that again is to not accept anything interesting.
fn clean_handle(raw: &str) -> FloorResult<String> {
    let trimmed = raw.trim();
    if trimmed.chars().count() < 3 {
        return Err(FloorError::BadRequest(
            "a handle needs at least three characters".into(),
        ));
    }
    if trimmed.chars().count() > HANDLE_MAX {
        return Err(FloorError::BadRequest(format!(
            "a handle is at most {HANDLE_MAX} characters"
        )));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(FloorError::BadRequest(
            "letters, digits, underscore and hyphen only".into(),
        ));
    }
    Ok(trimmed.to_string())
}

/// A guest name nobody has to choose. `Player-4f2a` and so on.
fn guest_handle() -> String {
    let raw = id("g");
    format!("Guest-{}", &raw[raw.len() - 4..])
}

/* ------------------------------------------------------------------ *
 * Sign-up, sign-in
 * ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub token: String,
    pub player: Player,
    pub wallet: WalletView,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestRequest {
    pub handle: Option<String>,
}

/// The front door. No email, no password, a wallet with something in it.
///
/// A guest is a real player row with a real wallet; the only thing they lack is
/// a password, which means their token is their account. That is the right
/// trade for a play-money floor: the fastest possible path from landing on the
/// page to a first bet, and an upgrade path — `claim` — that keeps the wallet.
pub async fn guest(
    State(state): State<AppState>,
    Json(body): Json<GuestRequest>,
) -> FloorResult<Json<Identity>> {
    let handle = match body
        .handle
        .as_deref()
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        Some(h) => clean_handle(h)?,
        None => guest_handle(),
    };
    create(&state, handle, None, "guest").await.map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRequest {
    pub handle: String,
    pub password: String,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<CredentialRequest>,
) -> FloorResult<Json<Identity>> {
    let handle = clean_handle(&body.handle)?;
    let hash = hash_password(&body.password)?;
    create(&state, handle, Some(hash), "member").await.map(Json)
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<CredentialRequest>,
) -> FloorResult<Json<Identity>> {
    let key = body.handle.trim().to_lowercase();

    let row: Option<(String, String, String, Option<String>)> =
        sqlx::query_as("SELECT id, handle, tier, password_hash FROM players WHERE handle_key = ?1")
            .bind(&key)
            .fetch_optional(state.pool())
            .await?;

    // One message for "no such handle" and "wrong password", because telling
    // the two apart is telling a stranger which handles exist.
    let bad = || FloorError::Forbidden("that handle and password do not match".into());
    let (player_id, handle, tier, stored) = row.ok_or_else(bad)?;
    let stored = stored.ok_or_else(bad)?;
    if !verify_password(&body.password, &stored) {
        return Err(bad());
    }

    let issued = issue_token(
        state.pool(),
        &player_id,
        state.config().token_ttl.as_millis() as i64,
    )
    .await?;
    let wallet = wallet::view(state.pool(), &player_id).await?;
    Ok(Json(Identity {
        token: issued,
        player: Player {
            id: player_id,
            handle,
            tier,
        },
        wallet,
    }))
}

/// Turn a guest into a member, keeping their wallet, their sessions and their
/// history. The whole reason a guest is a real row.
pub async fn claim(
    State(state): State<AppState>,
    Auth(player): Auth,
    Json(body): Json<CredentialRequest>,
) -> FloorResult<Json<Identity>> {
    if player.tier != "guest" {
        return Err(FloorError::Conflict(
            "that account already has a password".into(),
        ));
    }
    let handle = clean_handle(&body.handle)?;
    let hash = hash_password(&body.password)?;
    let key = handle.to_lowercase();

    let taken: Option<String> =
        sqlx::query_scalar("SELECT id FROM players WHERE handle_key = ?1 AND id <> ?2")
            .bind(&key)
            .bind(&player.id)
            .fetch_optional(state.pool())
            .await?;
    if taken.is_some() {
        return Err(FloorError::Conflict("that handle is taken".into()));
    }

    sqlx::query(
        "UPDATE players SET handle = ?1, handle_key = ?2, password_hash = ?3, tier = 'member' \
         WHERE id = ?4",
    )
    .bind(&handle)
    .bind(&key)
    .bind(&hash)
    .bind(&player.id)
    .execute(state.pool())
    .await?;

    let issued = issue_token(
        state.pool(),
        &player.id,
        state.config().token_ttl.as_millis() as i64,
    )
    .await?;
    let wallet = wallet::view(state.pool(), &player.id).await?;
    Ok(Json(Identity {
        token: issued,
        player: Player {
            id: player.id,
            handle,
            tier: "member".into(),
        },
        wallet,
    }))
}

pub async fn logout(
    State(state): State<AppState>,
    parts: axum::http::HeaderMap,
) -> FloorResult<Json<serde_json::Value>> {
    if let Some(value) = parts.get(axum::http::header::AUTHORIZATION) {
        if let Ok(raw) = value.to_str() {
            let presented = raw
                .trim_start_matches("Bearer ")
                .trim_start_matches("bearer ")
                .trim();
            sqlx::query("DELETE FROM tokens WHERE token_hash = ?1")
                .bind(token_hash(presented))
                .execute(state.pool())
                .await?;
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn create(
    state: &AppState,
    handle: String,
    password_hash: Option<String>,
    tier: &str,
) -> FloorResult<Identity> {
    let key = handle.to_lowercase();
    let player_id = id("plr");
    let now = now_ms();
    let stake = state.config().signup_stake;

    let mut tx = crate::db::write_tx(state.pool()).await?;

    let inserted = sqlx::query(
        "INSERT INTO players (id, handle, handle_key, tier, password_hash, created_at, last_seen_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(handle_key) DO NOTHING",
    )
    .bind(&player_id)
    .bind(&handle)
    .bind(&key)
    .bind(tier)
    .bind(&password_hash)
    .bind(now)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if inserted == 0 {
        return Err(FloorError::Conflict("that handle is taken".into()));
    }

    sqlx::query("INSERT INTO wallets (player_id, balance, updated_at) VALUES (?1, 0, ?2)")
        .bind(&player_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;

    wallet::credit(
        &mut tx,
        &player_id,
        stake,
        Movement::Signup,
        wallet::Context {
            memo: "welcome to the floor",
            ..Default::default()
        },
    )
    .await?;

    let issued = token();
    sqlx::query(
        "INSERT INTO tokens (token_hash, player_id, label, created_at, expires_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(token_hash(&issued))
    .bind(&player_id)
    .bind("sign-up")
    .bind(now)
    .bind(now + state.config().token_ttl.as_millis() as i64)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let view = wallet::view(state.pool(), &player_id).await?;
    Ok(Identity {
        token: issued,
        player: Player {
            id: player_id,
            handle,
            tier: tier.to_string(),
        },
        wallet: view,
    })
}

async fn issue_token(pool: &SqlitePool, player_id: &str, ttl_ms: i64) -> FloorResult<String> {
    let issued = token();
    let now = now_ms();
    sqlx::query(
        "INSERT INTO tokens (token_hash, player_id, label, created_at, expires_at) \
         VALUES (?1, ?2, 'sign-in', ?3, ?4)",
    )
    .bind(token_hash(&issued))
    .bind(player_id)
    .bind(now)
    .bind(now + ttl_ms)
    .execute(pool)
    .await?;
    Ok(issued)
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

fn hash_password(password: &str) -> FloorResult<String> {
    use argon2::password_hash::{PasswordHasher, SaltString};
    use argon2::Argon2;

    if password.chars().count() < 8 {
        return Err(FloorError::BadRequest(
            "a password needs at least eight characters".into(),
        ));
    }
    if password.len() > 256 {
        // Argon2 will happily hash a megabyte and that is a denial of service
        // with extra steps.
        return Err(FloorError::BadRequest("that password is too long".into()));
    }

    /*
     * The salt is sixteen bytes out of a v4 UUID, which is sixteen bytes from
     * the operating system's CSPRNG with six of them fixed to the version and
     * variant.
     *
     * `SaltString::generate` would be the idiomatic line, but reaching it
     * means depending on `rand_core` purely to turn on a feature argon2 does
     * not re-export — and a salt's job is uniqueness, not unpredictability.
     * 122 random bits is past any collision concern for a per-password value,
     * and the bytes come from the same place `OsRng` would have read them.
     */
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
        .map_err(|e| FloorError::Internal(format!("salt: {e}")))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| FloorError::Internal(format!("hashing failed: {e}")))
}

fn verify_password(password: &str, stored: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    use argon2::Argon2;

    let Ok(parsed) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/* ------------------------------------------------------------------ *
 * Me
 * ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub player: Player,
    pub wallet: WalletView,
    /// Total assets: wallet plus every chip on every open table.
    pub total: i64,
    pub open_tables: Vec<crate::sessions::SessionView>,
    /// When the next comp can be claimed, or null if one is waiting now.
    pub comp_ready_at: Option<i64>,
    pub comp_amount: i64,
}

pub async fn me(State(state): State<AppState>, Auth(player): Auth) -> FloorResult<Json<Me>> {
    let view = wallet::view(state.pool(), &player.id).await?;
    let open_tables = crate::sessions::open_for(state.pool(), &player.id).await?;
    let comp_ready_at = next_comp_at(&state, &player.id).await?;
    Ok(Json(Me {
        player,
        total: view.total(),
        wallet: view,
        open_tables,
        comp_ready_at,
        comp_amount: state.config().comp_amount,
    }))
}

/* ------------------------------------------------------------------ *
 * The comp
 * ------------------------------------------------------------------ */

/// When the cage will next hand out a comp, or `None` if it will now.
async fn next_comp_at(state: &AppState, player_id: &str) -> FloorResult<Option<i64>> {
    let last: Option<i64> = sqlx::query_scalar(
        "SELECT created_at FROM ledger WHERE player_id = ?1 AND kind = 'COMP' \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(player_id)
    .fetch_optional(state.pool())
    .await?;

    let interval = state.config().comp_interval.as_millis() as i64;
    Ok(match last {
        Some(at) if at + interval > now_ms() => Some(at + interval),
        _ => None,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompResult {
    pub granted: i64,
    pub wallet: WalletView,
    pub next_at: Option<i64>,
}

/// The cage comps a player who is out of money, on a timer.
///
/// Two things in one, deliberately: it is the daily bonus that brings somebody
/// back tomorrow, and it is the bailout that keeps a broke player from staring
/// at a floor they cannot play. The timer is what stops it being an infinite
/// bankroll — and a player who is genuinely at zero gets it without waiting,
/// because a play-money casino that locks a player out for eight hours has
/// simply lost them.
pub async fn comp(
    State(state): State<AppState>,
    Auth(player): Auth,
) -> FloorResult<Json<CompResult>> {
    let view = wallet::view(state.pool(), &player.id).await?;
    let flat_broke = view.total() == 0;

    if !flat_broke {
        if let Some(at) = next_comp_at(&state, &player.id).await? {
            let minutes = ((at - now_ms()) / 60_000).max(1);
            return Err(FloorError::Conflict(format!(
                "the cage has comped you already — back in {minutes} minute{}",
                if minutes == 1 { "" } else { "s" }
            )));
        }
    }

    let amount = state.config().comp_amount;
    let mut tx = crate::db::write_tx(state.pool()).await?;
    wallet::credit(
        &mut tx,
        &player.id,
        amount,
        Movement::Comp,
        wallet::Context {
            memo: if flat_broke {
                "on the house"
            } else {
                "the daily comp"
            },
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await?;

    let view = wallet::view(state.pool(), &player.id).await?;
    state.broadcast(crate::state::FloorSignal::Wallet {
        player_id: player.id.clone(),
        balance: view.balance,
        chips: view.chips,
        reason: "comp".into(),
    });

    let next_at = next_comp_at(&state, &player.id).await?;
    Ok(Json(CompResult {
        granted: amount,
        wallet: view,
        next_at,
    }))
}

/* ------------------------------------------------------------------ *
 * The ledger
 * ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct LedgerQuery {
    pub limit: Option<i64>,
}

pub async fn ledger(
    State(state): State<AppState>,
    Auth(player): Auth,
    Query(q): Query<LedgerQuery>,
) -> FloorResult<Json<serde_json::Value>> {
    let entries = wallet::recent(state.pool(), &player.id, q.limit.unwrap_or(40)).await?;
    Ok(Json(serde_json::json!({ "entries": entries })))
}
