# Knotz Crapz N Cardz

Casino games, built properly. Each game is a self-contained app under its own
folder; this repository is the collection they live in.

## Games

| Game | Where | State |
| --- | --- | --- |
| [Craps](TableGames/craps) | `TableGames/craps` | Playable — full layout, real dice physics, true odds |
| [Dragon's Shrine](SlotsGames/DragonsShrine) | `SlotsGames/DragonsShrine` | Playable — 5×4 video slot, free spins, hold-and-win, four jackpots |

More table and card games are on the way, which is what the shared
[`cardArt/`](cardArt) deck at the root is waiting for.

## Running a game

Each game carries its own `package.json` and runs on its own.

```bash
cd TableGames/craps
npm install
npm run dev        # http://localhost:3000

cd SlotsGames/DragonsShrine
npm install
npm run dev -- --port 3001
```

See [the craps README](TableGames/craps/README.md) for how it plays, what is on
the layout, and how the dice manage to be both genuine rigid-body physics and
exactly what the RNG called. See [the Dragon's Shrine
README](SlotsGames/DragonsShrine/README.md) for the paytable, the two features,
and what the return actually measures at.

## Deploying a game

Each game is client-side, so each one builds to static files and ships as an
nginx container rather than as a running Node app.

```bash
cd TableGames/craps
docker compose up -d --build            # http://localhost:8080

cd SlotsGames/DragonsShrine
docker compose up -d --build            # http://localhost:8081
```

They deliberately take different host ports, so both can run at once.

That is also what makes them playable on a phone: the same address on your
network installs to a home screen as an app. Each game's `DEPLOY.md` —
[craps](TableGames/craps/DEPLOY.md),
[Dragon's Shrine](SlotsGames/DragonsShrine/DEPLOY.md) — covers the container,
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
cardArt/                  a full 52-card PNG deck, shared by the card games
crapsPlan.md              the original specification for craps
```

The two games share a stack but not a build, and they share no code. That is
deliberate: a slot and a dice table have almost nothing in common beyond
"seeded RNG and a bankroll", and the cost of a shared abstraction over two
games is higher than the cost of two honest copies of eighty lines of RNG.

## Working in here

Games do not share a build. Run the checks from inside the game you are
touching:

```bash
cd TableGames/craps        # or SlotsGames/DragonsShrine
npm test                   # the fast suite
npm run typecheck
npm run lint
npm run test:stats         # the long simulations: house edge, or RTP
```

Each game keeps its own handoff notes —
[`TableGames/craps/handoff.json`](TableGames/craps/handoff.json) and
[`SlotsGames/DragonsShrine/handoff.json`](SlotsGames/DragonsShrine/handoff.json)
— covering architecture, the decisions worth knowing before changing anything,
and what is still open. Read the relevant one before touching an engine.
