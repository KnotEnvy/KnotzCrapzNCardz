//! Identifiers, bearer tokens, and the hash the database stores instead of a
//! token.

use sha2::{Digest, Sha256};
use uuid::Uuid;

/// A record id: `plr_`, `ses_` and so on, so a stray id in a log says what it
/// is without being looked up.
pub fn id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

/// A bearer token: 256 bits of CSPRNG output, hex.
///
/// Two v4 UUIDs rather than a hand-rolled `rand` call, because `Uuid::new_v4`
/// already goes to the operating system's CSPRNG and 122 bits from one is a
/// little thin for something that never expires in a dev session. The version
/// and variant bits are fixed and therefore worth nothing, so two of them is
/// 244 unpredictable bits, not 256 — still far past any margin that matters.
pub fn token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// What the database stores. A stolen backup is not a set of live sessions.
pub fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}
