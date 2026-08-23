# Knotz Craps

A full craps table for one or two players at one screen, with real dice physics
and true casino odds.

```bash
npm install
npm run dev        # http://localhost:3000
```

## Setting up

The first thing you see is the setup screen: solo or two players, names,
buy-in, re-buy, table minimum and maximum, the odds multiple, and the house
rules. Whatever you choose is what the table opens with — there is no second
trip through **House rules** to make it stick. **New session** later opens the
same form.

## Playing

Solo, the dice never leave your hand. With two seats, click a seat panel to arm
that player's rack — every bet you place goes to the armed seat, and chips carry
that seat's colour on the rim. The dice pass to the other player on a seven out,
exactly as they would in a casino.

| Key | Does |
| --- | --- |
| `Space` / `Enter` | Roll the dice |
| `1` … `7` | Pick a chip, cheapest first |
| `A` / `B` | Arm seat A or seat B |
| `O` | Take or lay full odds behind every line bet |
| `H` | Show or hide the stats panel |

Click a betting area to put the armed chip on it. Click a chip already on the
felt to add odds behind it; right-click a chip to take it down. The **Place /
Buy / Lay** switch decides what clicking a box number means.

### What a chip is actually worth

The number on the chip is not always the number that goes up, because a dealer
would not take it that way either:

- **The six and the eight are bet in sixes.** They pay 7:6, so chips convert
  from five-dollar units into six-dollar ones: a nickel is $6, a quarter is
  $30, a black is $120. Nobody at a real table says "twenty-five on the six"
  and means twenty-five.
- **A bet under the table minimum is taken at the minimum**, not refused. Drop
  a $5 chip on the pass line of a $15 table and $15 goes up.
- Both at once round to whatever is payable: a $5 chip on the six of a $15
  table lands on $18.

Turn this off with **Snap wagers to payable increments** if you would rather
the felt took your number literally.

`FAST` skips the dice animation, which is what you want when testing a betting
strategy over a few hundred rolls rather than playing.

Sessions save to the browser automatically, so closing the tab does not cost you
your bankroll.

## What is on the table

Everything a real layout carries:

- **Line bets** — pass, don't pass, come, don't come, all with odds behind them
  at the table's maximum (1x through 100x, 3-4-5x by default). Come bets travel
  to their number and are protected on the come-out seven, as they should be.
- **Box numbers** — place, buy (true odds less 5%), and lay against.
- **Field**, **Big 6 / Big 8**, and the **hardways**.
- **Propositions** — any seven, any craps, the four horn numbers, horn, world
  and C & E on the felt; **horn high** and all 21 **hop** bets behind the
  `Hop / Horn…` button.
- **Side bets** — the Fire Bet (24 / 249 / 999 to 1 for four, five, or six
  unique points) and All / Tall / Small.

### Dealer calls

The bar under the felt: **Inside** (5, 6, 8, 9), **Outside** (4, 5, 9, 10) and
**Across** (all six) place the armed chip on each number in one call, every one
of them getting its own minimum and increment treatment — so $25 across is $160,
not $150.

**Press** and **Power Press** act on the number that just hit, and say so: after
the eight rolls the buttons read `Press 8` and `Power 8`. Press adds one payable
unit; power press doubles it. Neither one reaches across the rest of the layout.

Also there: max odds, same action, all on, all off, and take down.

## House rules

Under **House rules** you can set the table minimum and maximum, the odds
multiple, whether the field pays double or triple on the twelve, whether buy and
lay commission is charged on the win or up front, whether place bets and
hardways sleep through the come-out, and whether single-roll bets ride after a
win. Defaults match a modern Strip table.

The dice run from a named seed, shown in the same panel. The same seed replays
the same session, which is useful if you want to test two betting strategies
against identical dice.

## How the dice work

The outcome is decided by the RNG before the throw starts, and the tumble you
watch is a genuine rigid-body simulation that finishes on exactly that outcome.
Those two things are usually in tension — you cannot ask a physics engine to
please land on a six — and the trick is in `src/lib/dice/simulate.ts`:

A uniform cube has an isotropic inertia tensor, and a cube collider is invariant
under the 24 rotations of the octahedral group. So replacing a die's initial
orientation `q0` with `q0 · R` for any cube symmetry `R` produces the *identical*
trajectory, with each recorded orientation `q(t)` becoming `q(t) · R`. The pips
simply ride around on a different face.

The simulator therefore runs one throw with arbitrary initial conditions, looks
at which face happened to land up, and picks the `R` that swaps the wanted face
into that slot. Real physics, the RNG's result, no rejection sampling and no
snapping at the end. The physics runs once up front and the renderer is a
playback head over the recorded poses.

## Layout

```
src/lib/engine/     the game, as pure functions over plain data
  types.ts          bets, table state, house rules
  odds.ts           every payout ratio, in one place
  rng.ts            xoshiro128** and two honest dice
  resolve.ts        applyRoll: the only function that moves money
  table.ts          creating a table and the legal moves between rolls
  stats.ts          the figures behind the HUD
src/lib/dice/       deterministic physics (see above)
src/lib/store/      zustand: table + dice animation + preferences
src/components/     felt, chips, dice stage, HUD, controls
  Setup.tsx         the start screen and the new-session form, one component
  table/Fx.tsx      what the felt does when a roll resolves
```

The engine has no React in it and no I/O. `applyRoll(table, roll)` returns a new
table, the settlements to animate, and a ledger record, which is what makes the
whole game replayable from a seed and testable without a browser.

## Tests

```bash
npm test           # 112 tests, about four seconds
npm run test:stats # long-running house-edge simulations
npm run typecheck
npm run lint
```

`npm test` covers the payout of every bet on the layout, the come-out and point
cycles, contract bets, come-bet travel and protection, working/off behaviour,
commission handling, the side bets, shooter rotation, solo play, chip
denomination conversion, the table minimum, the grouped place calls, and an
invariant that a bankroll never moves except by the settlements the engine
reports.

`npm run test:stats` is the real proof: it plays hundreds of thousands of
decisions and checks the measured house edge lands where the mathematics says it
should — 1.41% on the pass line, 1.36% on don't pass, 2.78% on the field, 16.67%
on any seven, and around 0.37% on the pass line backed with full odds. It also
checks all 36 dice combinations come up flat over 600,000 rolls. Every run is
seeded, so it is deterministic rather than flaky; the tolerance bands are theory
plus or minus three standard errors. It takes a few minutes.
