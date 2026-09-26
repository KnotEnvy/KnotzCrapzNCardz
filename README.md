# Knotz Crapz N Cardz

A casino, and the games in it. Each game is a self-contained app under its own
folder and still runs on its own; [the casino](casino) is the floor they live
on, and it holds the one bankroll they all share.

**To see it:**

```bash
docker compose up -d --build casino
```

…then open **<http://localhost:8090>**. The first build takes a few minutes and
is cached after that. [`casino/README.md`](casino/README.md#quick-start) covers
the rest, including how to run it without Docker.

## The casino

One wallet, four tables. Sitting down at a game buys chips out of the wallet;
standing up takes them back to the cage; and the chips stay on the table if you
close the tab, so nothing is lost by walking away mid-hand. See
[`casino/README.md`](casino/README.md) for the money model, the API, and what it
takes to plug a fifth game in — which is a manifest row, a build line, and about
two hundred lines that wire one game's store to the protocol. No engine changes.

The floor is [a Rust binary](casino/server): the wallet, an append-only ledger,
the table sessions, a live feed, and the static hosting for the shell and every
game, so the whole casino is one origin. The [shell](casino/shell) is the lobby,
the cage and the frame that brokers money between a game and the floor.

**The games themselves did not change to join it.** Each has exactly one new
file that knows a casino exists, and every engine, felt, paytable and animation
is untouched — which is checked the boring way: all four suites still pass with
the counts they passed with before.

## Games

| Game | Where | State |
| --- | --- | --- |
| [Craps](TableGames/craps) | `TableGames/craps` | Playable — full layout, real dice physics, true odds |
| [Dragon's Shrine](SlotsGames/DragonsShrine) | `SlotsGames/DragonsShrine` | Playable — 5×4 video slot, free spins, hold-and-win, four jackpots |
| [Blackjack 21](TableGames/blackjack) | `TableGames/blackjack` | Playable — three seats, every rule set, six side bets, strategy trainer and card counter |
| [Three Card Poker](TableGames/three-card-poker) | `TableGames/three-card-poker` | Playable — Ante and Play, Pair Plus, Ante Bonus, 6 Card Bonus; every paytable priced exactly, and a trainer that knows what each fold costs |

Blackjack and Three Card Poker both deal from the shared
[`cardArt/`](cardArt) deck at the root.

## Running a game

Each game carries its own `package.json` and runs on its own.

All of them use pnpm, pinned by a `packageManager` field. Run `corepack enable` once
and the right version fetches itself, which is the point of pinning it there
rather than in a README nobody re-reads: the version that built the lockfile is
the version that installs it, on a laptop and inside the Docker build alike.

```bash
cd TableGames/craps
pnpm install
pnpm run dev        # http://localhost:3000

cd SlotsGames/DragonsShrine
pnpm install
pnpm run dev -- --port 3001

cd TableGames/blackjack
pnpm install
pnpm run dev -- --port 3002

cd TableGames/three-card-poker
pnpm install
pnpm run dev -- --port 3003
```

The casino shell runs the same way, on 3010 — though it needs a floor to talk
to, so see [`casino/README.md`](casino/README.md) for the pair of terminals that
wants.

See [the craps README](TableGames/craps/README.md) for how it plays, what is on
the layout, and how the dice manage to be both genuine rigid-body physics and
exactly what the RNG called. See [the Dragon's Shrine
README](SlotsGames/DragonsShrine/README.md) for the paytable, the two features,
and what the return actually measures at. See [the blackjack
README](TableGames/blackjack/README.md) for the rule sets, the six side bets and
the edges they were each computed to carry. See [the Three Card Poker
README](TableGames/three-card-poker/README.md) for the paytables, the exact
figures behind every one of them, and why the Q-6-4 line is not a rule of thumb.

## Running the whole thing

```bash
docker compose up -d --build            # the casino on :8090, and the four games standalone
docker compose ps                       # what is up, and is it healthy
docker compose logs -f
docker compose down
```

**Open <http://localhost:8090>.** That is the casino, and every game is inside
it, sharing one bankroll.

The four standalone containers are still there and still independent — craps on
:8080, Dragon's Shrine on :8081, blackjack on :8082, three card poker on :8083 —
each with its own local bankroll and no floor behind it. They are not a second
copy of anything: they are the same code, and the only difference is that the
casino frames a game with `?casino=1` and answers its handshake. To run only the
casino, or only one game:

```bash
docker compose up -d --build casino     # http://localhost:8090
docker compose up -d --build blackjack  # http://localhost:8082, on its own
```

They deliberately take different host ports, so all five can run at once.

A game can also be brought up from its own folder:

```bash
cd TableGames/three-card-poker
docker compose up -d --build            # http://localhost:8083
docker compose down
```

**Both of those are the same stack.** The root file does not describe the games;
it `include`s each one's own compose file — and the casino's — so every service
is defined exactly once, next to the Dockerfile it builds. And every one of
those files pins the same project name, so starting a game from its folder joins
this stack rather than standing up a rival project beside it: `docker compose
ps` from the root lists it either way, and bringing it up from one place after
the other simply updates that one service.

That was not true before. The root file used to repeat all four service
definitions, which meant every port and hardening flag existed in two places
and could disagree — and because a compose project is named for the directory
it was started from, the two ways of starting a game fought over the container
name and Docker refused with an error that said nothing about why.

That is also what makes all of this playable on a phone: the same address on
your network installs to a home screen as an app, the casino included. Each
game's `DEPLOY.md` —
[craps](TableGames/craps/DEPLOY.md),
[Dragon's Shrine](SlotsGames/DragonsShrine/DEPLOY.md),
[blackjack](TableGames/blackjack/DEPLOY.md),
[three card poker](TableGames/three-card-poker/DEPLOY.md) — covers the container,
getting it onto the public internet, and the trade-offs between the ways of
doing that. The casino has [its own](casino/DEPLOY.md), and it is a different
problem: a game's container serves files and can be thrown away, while the
casino holds everybody's wallet.

## Layout

```
TableGames/craps/          Knotz Craps — Next.js, TypeScript, three.js, Rapier
  Dockerfile              builds it to static files, serves them from nginx
  DEPLOY.md               running it, and putting it on the web
SlotsGames/DragonsShrine/ Dragon's Shrine — Next.js, TypeScript, SVG, canvas
  Dockerfile              same shape: static build, nginx, no Node in production
  DEPLOY.md               running it, and putting it on the web
TableGames/blackjack/     Knotz Blackjack 21 — Next.js, TypeScript, SVG, CSS 3D cards
  Dockerfile              same shape again
  DEPLOY.md               running it, and putting it on the web
TableGames/three-card-poker/  Knotz Three Card Poker — the blackjack stack, a different felt
  Dockerfile              same shape again
  DEPLOY.md               running it, and putting it on the web
casino/                   the floor the games live on
  protocol/               the one contract: message types, both ends, the mode flag
  server/                 the floor — Rust, Axum, SQLx, SQLite; one binary
  shell/                  the lobby, the cage, the game frame — Next.js, static
  tools/                  vendor the protocol, build the whole casino
  Dockerfile              one image: the shell, all four games, and the floor
cardArt/                  a full 52-card PNG deck, shared by the card games
docker-compose.yml        the stack: the casino, plus each game standalone
crapsPlan.md              the original specification for craps
```

The games share a stack but not a build, and they share no code. That is
deliberate: a slot, a dice table and a card table have almost nothing in common
beyond "seeded RNG and a bankroll", and the cost of a shared abstraction over
them is higher than the cost of honest copies of eighty lines of RNG. The two
card tables are the closest pair, and even there the copy is the point:
Three Card Poker started from blackjack's store, felt and dialogs, kept what
eight rounds of review had already fixed, and changed what a different game
needs changed. They do share one thing, and it is an asset rather than a
module: the card deck in `cardArt/`, which each card table copies into its own
`public/` because a static export cannot reach outside it.

That prediction — that merging these tables into one casino would mean merging
the chrome and keeping the felts — turned out to be the wrong shape, and the
[casino](casino) is built the other way round. Nothing was merged. Each game is
hosted exactly as it is, in a frame, and money crosses the boundary as messages,
because the whole value of this repository is that four finished games already
work and are already tuned. A casino that imported them would have to make all
four agree on React version, CSS layer order and animation budget, and the first
disagreement would be paid for in the only currency that matters here: how the
games feel to play.

The duplicated chrome is therefore still duplicated, and is now *load-bearing*
rather than a seam waiting to be closed: each game's felt, primitives and audio
mixer are what make it a room, and the casino is deliberately not one of them.
The one thing that genuinely must not diverge is the protocol, and that is
vendored by a tool with a `--check` mode rather than left to discipline.

## Working in here

Games do not share a build, and neither does the casino. Run the checks from
inside whatever you are touching.

The one check that spans everything is the protocol, because it is the one thing
five apps have to agree about:

```bash
pnpm run casino:sync      # write the vendored copies
pnpm run casino:check     # fail if any copy has drifted
```

The casino's own suites:

```bash
cd casino/server
cargo test                  # the money path, end to end, through the real router
cargo clippy --all-targets
cargo fmt

cd casino/shell
pnpm test                   # the protocol, driven as a protocol: client vs host
pnpm run typecheck
pnpm run lint
```

And the games:

```bash
cd TableGames/craps        # or SlotsGames/DragonsShrine, TableGames/blackjack, TableGames/three-card-poker
pnpm test                   # the fast suite
pnpm run typecheck
pnpm run lint
pnpm run test:stats         # the long simulations: house edge, or RTP
```

Each app keeps its own handoff notes —
[`casino/handoff.json`](casino/handoff.json),
[`TableGames/craps/handoff.json`](TableGames/craps/handoff.json),
[`SlotsGames/DragonsShrine/handoff.json`](SlotsGames/DragonsShrine/handoff.json),
[`TableGames/blackjack/handoff.json`](TableGames/blackjack/handoff.json) and
[`TableGames/three-card-poker/handoff.json`](TableGames/three-card-poker/handoff.json) —
covering architecture, the decisions worth knowing before changing anything,
and what is still open. Read the relevant one before touching an engine — or,
for the casino, before touching anything that moves money.
