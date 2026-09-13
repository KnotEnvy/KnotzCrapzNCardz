# Knotz Casino

The floor the games live on. One bankroll, four tables, and a plug-in contract
so the fifth one is a manifest row rather than a rewrite.

```
                 ┌──────────────────────────────────────────┐
   browser       │  the shell  —  lobby, cage, game frame   │
                 └───────┬──────────────────────┬───────────┘
                         │ postMessage          │ HTTPS + WebSocket
                 ┌───────▼───────┐      ┌───────▼───────────┐
                 │  a game, in   │      │  the floor (Rust) │
                 │  an iframe    │      │  wallet · ledger  │
                 │  unchanged    │      │  sessions · feed  │
                 └───────────────┘      └───────┬───────────┘
                                                │
                                         ┌──────▼──────┐
                                         │  SQLite     │
                                         └─────────────┘
```

---

## Running it

```bash
pnpm run casino:build      # builds the shell and all four games into casino/dist
cargo run --release --manifest-path casino/server/Cargo.toml
```

…with `KNOTZ_SHELL_DIR=casino/dist/shell` and `KNOTZ_GAMES_DIR=casino/dist/games`
in the environment — the build script prints the exact line. Then open
<http://localhost:8090>.

Or in one container:

```bash
docker compose up -d --build casino     # http://localhost:8090
docker compose logs -f casino
```

### Working on the shell

The shell is a normal Next.js app and wants a floor to talk to:

```bash
# terminal 1 — the floor, serving the built games but not the shell
KNOTZ_GAMES_DIR=casino/dist/games cargo run --manifest-path casino/server/Cargo.toml

# terminal 2 — the shell on Next's dev server, pointed at it
cd casino/shell
NEXT_PUBLIC_FLOOR_URL=http://localhost:8090 \
KNOTZ_ALLOWED_ORIGINS=http://localhost:3010 pnpm dev
```

The second variable belongs to the *floor*, not the shell — it is the only
configuration that turns CORS on, and the only reason it exists is this
workflow. Note that game frames will load from the floor's origin, so the
handshake is cross-origin in dev and same-origin in production; the protocol is
written to work either way.

### Working on the server

```bash
cd casino/server
cargo test            # the money path, end to end, through the real router
cargo clippy --all-targets
cargo fmt
```

`cargo test` is the suite worth reading before changing anything about money:
twenty-eight tests that drive the real `Router` with real migrations and finish
by folding the ledger back up and comparing.

---

## The money model: chips at the table

There is one bankroll — the wallet — and it lives on the server. **A game never
touches it.** Instead:

| | |
| --- | --- |
| **Sitting down** | The wallet is debited and the same amount becomes the session's `chips`. One `BUY_IN` row. |
| **Playing** | The game reports what it holds after each settled round. The floor writes it to the session. **No ledger row, no wallet movement** — chips moving around a table have not crossed the cage. |
| **Standing up** | The chips move back to the wallet. One `CASH_OUT` row, and the session closes. |
| **Walking away** | Nothing. The chips stay on the table, the server still has them, and the lobby offers them back. |

So a ten-thousand-spin slot session is two ledger entries rather than ten
thousand, and the only place money can be is the wallet or a table.

That last row is the one the whole design is for. A game is a client-side app in
a frame; frames get closed, phones get lost, tabs get killed by an OS under
memory pressure. In this model none of that loses money — the worst case is
that the last half-second of play is void, and the chips are waiting on the
floor next time.

### What the books guarantee

`GET /api/v1/audit` folds the ledger back up and checks three things:

1. `sum(ledger.amount)` equals `wallet.balance`, exactly, for every player.
2. Every `BUY_IN` and `TOP_UP` against a session adds up to that session's
   `buy_in`.
3. A closed session holds no chips and has been paid out exactly once.

The tempting fourth identity — that chips tie back to the ledger — **does not
hold and must not be asserted.** A player who buys in for a thousand and runs it
to nine has eight thousand dollars of chips the ledger has never seen, because
the game's engine created them and nothing crossed the cage. That money becomes
real to the books at cash-out, in one row. Which is exactly how a table float
works, and exactly why a cage counts a rack rather than deriving it.

### Where the trust boundary sits

The floor does not re-derive a hand of blackjack or re-roll a pair of dice. It
could not: the engines that do that *are* the games, each is already tested
against its own exact mathematics, and moving them here would mean rewriting all
four and reproducing every published figure.

So this is a play-money floor where **the client is the authority on the outcome
of a round** and **the server is the authority on everything that crosses the
cage** — what a buy-in cost, what a cash-out paid, what the wallet holds, and
the fact that a session cannot pay out twice.

A real-money deployment would move each engine behind this API and have the game
render a result it was *given* rather than one it computed. The protocol is
shaped so that is a change of who calls the engine, not a change of what the
floor looks like: `chips` would come from the server on every round instead of
from the game, and every other message stays as it is.

---

## Adding a game

A game joins this floor by being four things. None of them is "be rewritten".

**1. A static site that speaks the protocol.** Copy `casino/protocol/client.ts`
(the sync tool does it for you) and write a link module that wires it to your
game's own store. The four in this repository are the worked examples, and they
are short:

| Game | Link module | The interesting part |
| --- | --- | --- |
| [Craps](../TableGames/craps/src/lib/casino/link.ts) | ~200 lines | Counts in whole dollars; carries the cents that do not divide |
| [Blackjack](../TableGames/blackjack/src/lib/casino/link.ts) | ~250 lines | One stack spread across three boxes |
| [Three Card Poker](../TableGames/three-card-poker/src/lib/casino/link.ts) | ~230 lines | Same, plus four wagers per seat |
| [Dragon's Shrine](../SlotsGames/DragonsShrine/src/lib/casino/link.ts) | ~200 lines | A credit meter, and a gamble that holds money outside it |

A link does four things: take the buy-in, report the position, close off any
action that creates money from nowhere, and shout about a jackpot. It touches no
engine.

**2. A row in the catalog** — `casino/server/src/catalog.rs`. The slug, the
title, the accent colours, the limits, the default buy-in, and the figure the
game's own simulation suite measures. There is no per-game code in the server
and no per-game table in the database.

**3. A line in the build script** — `casino/tools/build-casino.mjs`, so it gets
built with `CASINO_BASE_PATH=/games/<slug>` and lands in the right directory.

**4. `persistKey()` on its store's storage name**, so a casino session and a
standalone session do not share a save file.

That is the whole integration. The tile, the cashier, the wallet HUD, the
leaderboard, the ledger and the ticker all work from the manifest.

### The two rules a game has to obey

**Do not move money before `hello` arrives.** Until the handshake completes a
game must behave exactly as it does on its own — which is what keeps every game
here independently playable, and is why `?casino=1` plus a frame is the *special*
case rather than the default.

**Report everything at the table, rack plus at-risk.** `chips` is what the cage
owes if the tab closes right now, not what is currently idle.

---

## The parts

| Path | What it is |
| --- | --- |
| [`protocol/`](protocol) | The canonical contract. `protocol.ts` is the message types, `client.ts` is a game's end, `host.ts` is the floor's, `mode.ts` answers "am I on the floor". |
| [`server/`](server) | The floor. Axum, SQLx, SQLite. One binary that also serves the shell and every game. |
| [`shell/`](shell) | The lobby, the cage, and the frame that brokers money. Next.js, static export. |
| [`tools/`](tools) | `sync-protocol.mjs` vendors the protocol and `--check`s for drift; `build-casino.mjs` builds the whole casino. |
| `dist/` | Build output. Not committed. |

### Why the protocol is vendored rather than imported

Every app here builds from its own folder with its own Dockerfile whose build
context *is* that folder — which is what lets a game ship without the rest of
this repository existing. A shared workspace package would be reachable from a
laptop and invisible from inside every one of those builds.

So the protocol is copied, and the thing that normally makes copying a bad idea —
two of them silently disagreeing about money — is handled by making divergence a
failure:

```bash
pnpm run casino:sync       # write the copies
pnpm run casino:check      # fail if any has drifted
```

`casino:check` runs first in the build script, so a drifted copy fails in twenty
seconds rather than after twenty minutes of Next builds.

### Why Rust for the floor

The floor is a ledger with a web server bolted to it, and both halves want the
same things.

**It must not be wrong about money.** Integer cents end to end, a type system
that will not let a missing balance be treated as zero, and no garbage collector
choosing to pause between a debit and the ledger row that explains it.

**It must be boring to run.** One statically linked binary, a few megabytes
resident, and a SQLite file. No runtime to install, no interpreter version to
pin; the container is a base image plus one executable.

**It has to hold sockets open.** Every seated player keeps a WebSocket for their
balance. Tokio's per-task cost is measured in hundreds of bytes, so "every tab
on the floor holds a socket" is a non-decision rather than a capacity plan.

The honest alternative was Go and it would have been fine. Rust wins on the
first point: `Option`, `Result` and checked integer arithmetic turn three
classes of accounting bug into compile errors and test failures rather than a
wrong number in somebody's wallet.

### Two things SQLite needed told

Both are in [`server/src/db.rs`](server/src/db.rs) with the full reasoning, and
both were found by a test rather than by reading:

- **WAL.** Without it every reader serialises behind every writer, which is the
  opposite of the floor's traffic shape.
- **`BEGIN IMMEDIATE` on every money path.** SQLite's default `BEGIN` is
  deferred, so a read-then-write transaction has to upgrade its lock — and if
  another connection holds the write lock, SQLite returns `SQLITE_BUSY`
  *immediately*, ignoring `busy_timeout`, because waiting would deadlock. Every
  money-moving handler has exactly that shape, so two concurrent buy-ins
  produced one success and one 500. Taking the write lock up front makes the
  loser queue instead. There is a test for the race.

---

## The API

Everything under `/api/v1`. Amounts are integer cents. Auth is an opaque bearer
token, stored hashed and revocable.

| | |
| --- | --- |
| `POST /auth/guest` | A player, a wallet with the opening stake, and a token. No email, no password. |
| `POST /auth/register` · `/auth/login` | The same with a password. |
| `POST /auth/claim` | Turn a guest into a member, **keeping the wallet and every open table**. |
| `GET /me` | Player, wallet, total worth, open tables, comp timer. |
| `POST /me/comp` | The daily comp — or an immediate bailout when the player is flat broke. |
| `GET /me/ledger` | Every movement of money. |
| `GET /games` | The catalog. Everything the shell needs to draw a tile and seat a player. |
| `POST /sessions` | Sit down. Debits the wallet, or resumes a table with chips still on it. |
| `POST /sessions/{id}/sync` | A position. Idempotent on a monotonic `seq`. |
| `POST /sessions/{id}/top-up` | More chips, without leaving the table. |
| `POST /sessions/{id}/cash-out` | Stand up. Pays exactly once. |
| `POST /sessions/{id}/event` | Something for the ticker. |
| `GET /table` | What a game sees, authenticating with its own session token. |
| `GET /ticker` · `/leaderboard` | Public. The lobby shows both before anybody signs in. |
| `GET /ws` | The live feed: this player's balance, and everybody's good news. |
| `GET /health` · `/audit` | Is it up, and do the books fold up. |

### Configuration

Environment only; every value has a default that produces a working floor on a
laptop with nothing set. See [`server/src/config.rs`](server/src/config.rs).

| | |
| --- | --- |
| `PORT` · `HOST` | Default `8090` on `0.0.0.0`. |
| `KNOTZ_DB` | A path or a `sqlite:` URL. Default `floor.db` beside the binary. |
| `KNOTZ_SHELL_DIR` · `KNOTZ_GAMES_DIR` | Where the built static files are. Unset means API only. |
| `KNOTZ_SIGNUP_STAKE` · `KNOTZ_COMP` · `KNOTZ_COMP_INTERVAL_SECS` | Cents, cents, seconds. |
| `KNOTZ_TOKEN_TTL_SECS` | How long a sign-in lasts. |
| `KNOTZ_ALLOWED_ORIGINS` | Comma-separated. Empty — the shipped configuration — means same-origin and no CORS layer at all. |

---

## Play money

No purchase, no cash value, nothing to withdraw. Every edge and return the floor
quotes is measured by that game's own simulation suite, and each game's README
shows the working.
