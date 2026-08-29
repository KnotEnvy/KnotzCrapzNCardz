# Knotz Crapz N Cardz

Casino games, built properly. Each game is a self-contained app under its own
folder; this repository is the collection they live in.

## Games

| Game | Where | State |
| --- | --- | --- |
| [Craps](TableGames/craps) | `TableGames/craps` | Playable — full layout, real dice physics, true odds |

More table and card games are on the way, which is what the shared
[`cardArt/`](cardArt) deck at the root is waiting for.

## Running a game

Each game carries its own `package.json` and runs on its own. For craps:

```bash
cd TableGames/craps
npm install
npm run dev        # http://localhost:3000
```

See [the craps README](TableGames/craps/README.md) for how it plays, what is on
the layout, and how the dice manage to be both genuine rigid-body physics and
exactly what the RNG called.

## Deploying a game

Each game is client-side, so each one builds to static files and ships as an
nginx container rather than as a running Node app. For craps:

```bash
cd TableGames/craps
docker compose up -d --build   # http://localhost:8080
```

That is also what makes it playable on a phone: the same address on your
network installs to an iPhone home screen.
[TableGames/craps/DEPLOY.md](TableGames/craps/DEPLOY.md) covers the container,
getting it onto the public internet, and the trade-offs between the ways of
doing that.

## Layout

```
TableGames/craps/   Knotz Craps — Next.js, TypeScript, three.js, Rapier
  Dockerfile        builds it to static files, serves them from nginx
  DEPLOY.md         running it, and putting it on the web
SlotsGames/         reserved for what comes next
cardArt/            a full 52-card PNG deck, shared by the card games
crapsPlan.md        the original specification for craps
```

## Working in here

Games do not share a build. Run the checks from inside the game you are
touching:

```bash
cd TableGames/craps
npm test           # 216 tests, about ten seconds
npm run typecheck
npm run lint
```

Craps keeps its own handoff notes in
[`TableGames/craps/handoff.json`](TableGames/craps/handoff.json) — architecture,
the decisions worth knowing before changing anything, and what is still open.
Read that before touching the engine or the dice.
