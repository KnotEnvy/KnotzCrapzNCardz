# Dragon's Shrine

A five-reel, four-row video slot with fifty paylines, two features, four
jackpots, and a dragon that does not sit still. It is the second game in
[this collection](../../README.md), and the first one that is not played with
dice or cards.

Everything on screen is drawn in code — the twelve symbols are SVG, the shrine
behind the reels is SVG, the particles are a canvas, and every sound is
synthesised from oscillators and filtered noise when it plays. There are no
image files and no audio files in the repository, which is why the whole game
is 0.3 MB over the wire.

```bash
npm install
npm run dev -- --port 3001
```

---

## How it plays

Fifty paylines, all of them always active, paying left to right from reel 1.
The stake ladder runs from 50¢ to $100 a spin, and every regular symbol pays a
multiple of the **line** bet while everything scattered — the pearl, the orbs,
the jackpots — pays a multiple of the **whole** stake.

| | Symbols |
| --- | --- |
| Low | Coin, Lotus, Fan, Lantern |
| Mid | Koi, Turtle, Tiger |
| High | Phoenix, Dragon |
| Special | Wild shrine gate, Golden pearl (scatter), Fire orb |

The wild substitutes for everything except the pearl and the orb. It never
appears on reel 1 of the base game — a wild on the leftmost reel turns every
three of a kind into a four, and that is a large and invisible chunk of return.

**Dragon Rage** fires at random on about one base spin in thirty-six and turns
two to six regular cells wild before the board is read. It only ever burns a
regular symbol: a random event that could turn one of your six orbs into a wild
would be taking something away from you under a rule you were never told.

### Shrine of Flames — free spins

Three, four or five pearls award 10, 15 or 20 free spins, plus the pearl pay
itself. Inside, the reels run a richer band with no orbs on it, and two things
happen that do not happen in the base game:

- The **dragon takes a reel**. One, two or occasionally three of reels 2, 3 and
  4 turn wild top to bottom. Never reel 1 — with it wild, a three-reel dragon
  spin would be fifty lines of five wilds, and one spin would be worth more than
  the rest of the feature put together.
- The **multiplier trail** advances: 1× → 2× → 3× → 5× → 10×. Every dragon reel
  and every extra pearl moves it up a rung, and it never moves back inside a
  session. Three more pearls retrigger for five more spins.

A session averages **10.5 spins** and the feature is where **34%** of the whole
game's return lives.

### Shrine Link — hold and win

Six or more fire orbs light the link. The board clears, the orbs lock where
they fell, and you get three respins. Every orb that lands resets the counter
to three; every orb holds. Each carries a credit value from 1× to 50× the
stake, or a MINI or MINOR jackpot.

Fill eighteen of the twenty cells and the **MAJOR** is yours. Fill all twenty
and the **GRAND** is. Those two are board awards and can never be carried by an
orb — a jackpot that lands unannounced on the first respin is a lottery ticket,
and one you can watch yourself approach is a feature. Sessions run **8.9
respins** on average.

### The rest

- **Gamble** — double or nothing on a red/black lantern, up to five times, on
  any win up to 50× the stake. It is exactly fair: a 50/50 flip with no house
  edge in it, which the test suite measures over 100,000 flips rather than
  taking on trust.
- **Buy a feature** — 80× for free spins, 64× for the link, 255× for a
  five-pearl super buy. See below for why those are the numbers they are.
- **Autoplay** up to 250 spins or unlimited, pausing on a feature and on a big
  win. **Turbo** shortens every beat of a spin except the anticipation, because
  a tease that is over before it registers is worse than no tease.
- Keyboard throughout: space to spin, arrows for the stake, `M` max bet, `T`
  turbo, `A` autoplay, `I` paytable, `S` sound, `Esc` to skip a celebration.

---

## What it actually returns

Not a target — a measurement. `npm run test:stats` plays twenty million seeded
spins and reports where every fraction of the return comes from:

```
DRAGON'S SHRINE — MEASURED RETURN over 20,000,000 spins at $50.00

source                                RTP     share
---------------------------------------------------
base game line wins               50.030%   51.814%
pearl (scatter) pays               1.071%    1.109%
free spins — Shrine of Flames     34.262%   35.484%
hold & win — orb credits           7.188%    7.444%
  jackpot MINI                     0.887%    0.918%
  jackpot MINOR                    0.609%    0.631%
  jackpot MAJOR                    1.735%    1.797%
  jackpot GRAND                    0.775%    0.803%
---------------------------------------------------
TOTAL                             96.556%  100.000%
  95% interval                  +/-0.595%
  target band                   95.500%–96.800%
```

The suite refuses to report a figure it cannot stand behind: it fails if the
confidence interval is wider than half the target band, so the sample size has
to earn the claim rather than the claim being made at whatever precision the
run happened to reach.

| | |
| --- | --- |
| Hit frequency | 33.1% — about one spin in three |
| Volatility | 13.6 (standard deviation of return per spin) |
| Largest single spin seen | 5,640× stake |
| Free spins | 1 in 222 spins |
| Hold and win | 1 in 539 spins |
| MINI / MINOR / MAJOR / GRAND | 1 in 2,256 / 8,210 / 28,818 / 645,161 |

The split matters as much as the total. A machine that returns 96% entirely
through its base game is a different and much duller machine than one that
returns it through a bonus, even though the two measure identically — so the
simulation reports both, and the target is a shape as well as a number.

### Why the buy buttons cost what they cost

Each feature's raw worth was measured, not guessed: pin its price at 1× the
stake, let the simulation report what it returns, and that number *is* what the
feature is worth — 75.5× for the shrine, 59.8× for the link, 240× for the super
buy. Divide by the base game's measured return and you get the window of prices
that leave the button at or just below the deal the spin button offers. The
price sits in the middle of that window, where measurement error has the most
room on either side.

| Button | Cost | Returns | vs. base game |
| --- | --- | --- | --- |
| Free spins | 80× | 93.99% | −2.57% |
| Hold and win | 64× | 93.09% | −3.47% |
| Super (5 pearls) | 255× | 94.32% | −2.23% |

Both ends of that window are asserted by the test suite. Priced too low, the
button is the only correct way to play and the base game is decoration. Priced
too high it is a trap sold to the player least willing to wait.

---

## How it is built

Next.js 16, React 19, TypeScript, Zustand, Tailwind v4, `motion`, and vitest —
the same stack as [the craps table](../../TableGames/craps), minus three.js and
Rapier. Craps needs a physics engine because its dice are rigid bodies; a slot
cabinet is a 2D machine, and SVG symbols with a canvas particle layer are both
crisper at any size and an order of magnitude lighter.

```
src/lib/engine/    the maths. Pure, seeded, and the only thing that decides money
  types.ts         the published data contract every other layer compiles against
  rng.ts           xoshiro128**, seeded from a string, with a fixed draw order
  strips.ts        the reel bands, declared as counts and expanded deterministically
  paytable.ts      every number that gets tuned against the simulation
  lines.ts         the fifty paylines
  evaluate.ts      the only place that decides what a board is worth
  spin.ts          one pull of the handle, start to finish
  features.ts holdwin.ts gamble.ts buy.ts
src/lib/store/     the brain: phase machine, spin choreography, the money path
src/lib/audio.ts   every sound, synthesised at play time
src/components/
  symbols/         twelve emblems, drawn in SVG
  reels/           the reel window and its motion model
  cabinet/         top glass, jackpots, meters, control deck, dialogs
  features/        free spins, the link, the gamble, the big-win takeovers
  fx/              the parallax shrine, and the particle canvas
```

Three ideas hold it together.

**The engine is pure and the store never invents money.** Hand `spin()` a
generator, a stake and a mode and it hands back everything that spin did. The
store's job is to debit, ask, and pay exactly what came back — it does not
import the evaluator at all, because a second opinion about what a board is
worth is precisely the bug you never find.

**One seed reproduces a session.** Every random word comes out in a documented,
fixed order, which is what makes the RTP figure above a measurement rather than
an estimate, and what lets a spin worth arguing about be replayed exactly. A
test pins that order by counting words rather than by checking a board, so
retuning the strips does not falsify it but inserting a draw does.

**Money is integer cents, everywhere.** A slot pays fractions of a line bet
hundreds of times an hour, and floating-point drift in a bankroll is a bug you
find three weeks later in a screenshot.

### Checks

```bash
npm test          # 125 tests, about two seconds
npm run typecheck
npm run lint
npm run test:stats   # twenty million spins, about five minutes
```

The fast suite splits along a clean line: `engine.test.ts` asks whether the
machine obeys its own rules, on boards built by hand; `store.test.ts` asks
whether the money is right, and its load-bearing assertion is the identity
`bankroll === start − wagered + won`, checked after every settled spin.

`handoff.json` carries the architecture notes, the decisions worth knowing
before changing anything, and what is still open. Read it before touching the
engine or the sequencer.

---

## Deploying

It builds to static files and ships as nginx with no Node in the image.

```bash
docker compose up -d --build   # http://localhost:8081
```

[DEPLOY.md](DEPLOY.md) covers the container, putting it on the public internet,
and the trade-offs between the ways of doing that.
