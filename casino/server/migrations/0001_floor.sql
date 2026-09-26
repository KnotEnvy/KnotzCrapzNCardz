-- The floor's books.
--
-- Every amount in this schema is an integer number of cents. There is no
-- floating point anywhere in the money path, deliberately: a casino that
-- stores a balance as a double is a casino that eventually owes somebody
-- 4999.999999999999 dollars.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

CREATE TABLE players (
  id            TEXT PRIMARY KEY,
  handle        TEXT NOT NULL,
  -- Lower-cased handle, so two players cannot differ only in capitals.
  handle_key    TEXT NOT NULL UNIQUE,
  tier          TEXT NOT NULL DEFAULT 'guest' CHECK (tier IN ('guest', 'member', 'vip')),
  -- NULL for a guest: their token is their only credential, and it lives in
  -- the browser that created it.
  password_hash TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- The wallet
--
-- One row per player, and the only balance in the system. `balance` is a
-- cached fold of the ledger: every write to it happens in the same
-- transaction as the ledger row that explains it, and `/api/v1/audit` folds
-- the ledger back up and compares. A discrepancy there is a bug in this
-- server, not a rounding artefact, because there is nothing to round.
--
-- `balance` is spendable money. Chips on a table are not in it -- see
-- `sessions` below -- so what a player is *worth* is this plus those, which
-- is a figure the API computes and never stores.
-- ---------------------------------------------------------------------------

CREATE TABLE wallets (
  player_id        TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  balance          INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  -- Lifetime figures, for the profile card. Cumulative, never reset.
  lifetime_in      INTEGER NOT NULL DEFAULT 0,
  lifetime_wagered INTEGER NOT NULL DEFAULT 0,
  lifetime_won     INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Table sessions: chips in front of a player at one game.
--
-- A session is a table float. The wallet funds it and the cage settles it, and
-- in between the game moves the chips around without the ledger hearing about
-- it -- because a hand that pays three to two creates chips that never crossed
-- the cage. So there are two records and they answer different questions:
--
--   * the ledger says what crossed the cage, and folds up exactly to the
--     wallet balance;
--   * `chips` says what the rack holds right now, and becomes a ledger row
--     once, at cash-out.
--
-- The checks that follow from that are in `wallet::audit`: every buy-in and
-- top-up recorded against a session adds up to its `buy_in`, and a closed
-- session holds nothing and has been paid out exactly once.
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  -- What the table holds right now. Reported by the game, clamped by nothing:
  -- the game's own engine is the authority on its own payouts, and the floor
  -- is the authority on what crossed the cage. See `seq`.
  chips      INTEGER NOT NULL DEFAULT 0 CHECK (chips >= 0),
  -- Everything ever bought in for on this session, for the net figure.
  buy_in     INTEGER NOT NULL DEFAULT 0,
  wagered    INTEGER NOT NULL DEFAULT 0,
  won        INTEGER NOT NULL DEFAULT 0,
  rounds     INTEGER NOT NULL DEFAULT 0,
  -- Highest sequence number applied. A sync at or below it is a replay of a
  -- position the floor already has and is dropped, which is what makes the
  -- sync endpoint idempotent under a retry or a duplicated frame message.
  seq        INTEGER NOT NULL DEFAULT 0,
  -- SHA-256 of the session token handed to the game.
  token_hash TEXT NOT NULL,
  opened_at  INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at  INTEGER
);

CREATE INDEX sessions_by_player ON sessions(player_id, state, opened_at DESC);
-- A player has at most one open session per game. The partial index is what
-- makes "resume the table you left" a lookup rather than a scan, and makes a
-- second open table at the same game impossible rather than merely unlikely.
CREATE UNIQUE INDEX sessions_one_open_per_game
  ON sessions(player_id, game) WHERE state = 'OPEN';

-- ---------------------------------------------------------------------------
-- The ledger: append-only, one row per movement of money.
--
-- Nothing in here is ever updated or deleted. A correction is another row.
-- ---------------------------------------------------------------------------

CREATE TABLE ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- Signed: negative leaves the wallet, positive enters it. The sum of this
  -- column for a player is their balance, by construction.
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN (
    'SIGNUP',     -- the opening stake
    'COMP',       -- a comp from the cage: the daily, or a bailout
    'BUY_IN',     -- wallet to table
    'CASH_OUT',   -- table to wallet
    'TOP_UP',     -- wallet to a table already open
    'ADJUST'      -- a correction; carries its reason in memo
  )),
  session_id    TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  game          TEXT,
  memo          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE INDEX ledger_by_player ON ledger(player_id, id DESC);

-- ---------------------------------------------------------------------------
-- Auth tokens. Opaque, hashed, revocable.
--
-- Not JWTs: the floor has a database in front of it on every request anyway,
-- so the only thing a stateless token would buy is the inability to revoke
-- one. A row per token means logging out actually logs you out.
-- ---------------------------------------------------------------------------

CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX tokens_by_player ON tokens(player_id);

-- ---------------------------------------------------------------------------
-- The ticker. Jackpots, big wins, features — the things a floor shouts about.
-- ---------------------------------------------------------------------------

CREATE TABLE floor_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  handle     TEXT NOT NULL,
  game       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  label      TEXT NOT NULL,
  amount     INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX floor_events_recent ON floor_events(id DESC);
