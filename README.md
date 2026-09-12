# Knotz Crapz N Cardz

Casino games, built properly. Each game is a self-contained app under its own
folder; this repository is the collection they live in.

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

See [the craps README](TableGames/craps/README.md) for how it plays, what is on
the layout, and how the dice manage to be both genuine rigid-body physics and
exactly what the RNG called. See [the Dragon's Shrine
README](SlotsGames/DragonsShrine/README.md) for the paytable, the two features,
and what the return actually measures at. See [the blackjack
README](TableGames/blackjack/README.md) for the rule sets, the six side bets and
the edges they were each computed to carry. See [the Three Card Poker
README](TableGames/three-card-poker/README.md) for the paytables, the exact
figures behind every one of them, and why the Q-6-4 line is not a rule of thumb.

## Running the arcade

Each game is client-side, so each one builds to static files and ships as an
nginx container rather than as a running Node app. The `docker-compose.yml` at
the root builds and runs all of them together:

```bash
docker compose up -d --build            # craps :8080, Dragon's Shrine :8081, blackjack :8082, three card poker :8083
docker compose logs -f
docker compose down
```

They deliberately take different host ports, so all four can run at once — the
arcade is four independent containers that happen to be started by one file,
not a shared server.

To run only one game, use its own compose file instead. Those still work
standalone and take the same ports:

```bash
cd TableGames/craps
docker compose up -d --build            # http://localhost:8080

cd SlotsGames/DragonsShrine
docker compose up -d --build            # http://localhost:8081

cd TableGames/blackjack
docker compose up -d --build            # http://localhost:8082

cd TableGames/three-card-poker
docker compose up -d --build            # http://localhost:8083
```

Pick one way or the other for a given game, not both at once. Container names
are pinned so they stay predictable, and Docker will not give the same name to
two containers, so a game started from its own folder has to come down before
the root file can start it.

That is also what makes them playable on a phone: the same address on your
network installs to a home screen as an app. Each game's `DEPLOY.md` —
[craps](TableGames/craps/DEPLOY.md),
[Dragon's Shrine](SlotsGames/DragonsShrine/DEPLOY.md),
[blackjack](TableGames/blackjack/DEPLOY.md),
[three card poker](TableGames/three-card-poker/DEPLOY.md) — covers the container,
getting it onto the public internet, and the trade-offs between the ways of
doing that.

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
cardArt/                  a full 52-card PNG deck, shared by the card games
docker-compose.yml        builds and runs every game at once
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

When these tables are merged into one casino, those copies are the seams: the
chrome (pit greys, brass, the button and panel primitives, the audio mixer) is
already identical, and each table's felt, engine and store are self-contained.

## Working in here

Games do not share a build. Run the checks from inside the game you are
touching:

```bash
cd TableGames/craps        # or SlotsGames/DragonsShrine, TableGames/blackjack, TableGames/three-card-poker
pnpm test                   # the fast suite
pnpm run typecheck
pnpm run lint
pnpm run test:stats         # the long simulations: house edge, or RTP
```

Each game keeps its own handoff notes —
[`TableGames/craps/handoff.json`](TableGames/craps/handoff.json),
[`SlotsGames/DragonsShrine/handoff.json`](SlotsGames/DragonsShrine/handoff.json),
[`TableGames/blackjack/handoff.json`](TableGames/blackjack/handoff.json) and
[`TableGames/three-card-poker/handoff.json`](TableGames/three-card-poker/handoff.json) —
covering architecture, the decisions worth knowing before changing anything,
and what is still open. Read the relevant one before touching an engine.
