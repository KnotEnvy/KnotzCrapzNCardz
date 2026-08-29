# Knotz Craps

A full craps table for one or two players at one screen, with real dice physics,
true casino odds, and a strategy workshop for building systems and playing
against them.

```bash
npm install
npm run dev        # http://localhost:3000
```

Or run the packaged build, which is what gets deployed:

```bash
docker compose up -d --build   # http://localhost:8080
```

See [DEPLOY.md](DEPLOY.md) for putting it on the web, and for playing it on a
phone — it installs to an iPhone home screen and wants to be held sideways.

## Setting up

The first thing you see is the setup screen: solo or two players, names, what
each seat is playing, buy-in, re-buy, table minimum and maximum, the odds
multiple, and the house rules. Whatever you choose is what the table opens with
— there is no second trip through **House rules** to make it stick. **New
session** later opens the same form.

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
| `S` | Run the armed seat's strategy once |

Click a betting area to put the armed chip on it. Click a chip already on the
felt to add odds behind it; right-click a chip to take it down.

Each box number is divided into three bands, the way a dealer divides it. The
top band, under **LAY**, lays against the number; the bottom band, under
**PLACE**, places it; the number itself takes whatever the **Place / Buy / Lay**
switch has armed. Hovering tints the band you are about to bet, warm for the
right side and cool for the don't side, and the tooltip names the bet and quotes
the house edge. `D/C` and `COME` mark where a travelling bet's chips come to
rest, so you can always find your money.

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

This is not optional, and there is no switch for it. A table only books a bet
it can pay evenly, so every wager is taken at a payable multiple: sixes on the
six and eight, fives on the other box numbers and on buy and lay, fours on the
horn, twos on C & E. Rounding is always up, the way a dealer takes the extra
dollar rather than handing change back. It is also what keeps every payout a
whole number of dollars.

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
- **Propositions** — any seven, any craps, the four horn numbers, the four
  **horn high** calls, horn, world and C & E, all printed on the felt; all 21
  **hop** bets behind the `Hop / Horn…` button.
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

## Strategies

**Strategies** in the top bar opens the workshop. Seventeen systems ship with
the game, from the pass line with full odds through the Iron Cross and the
dark-side Molly to the Fire Bet chaser, and every one of them is written in the
same rule language the builder gives you — nothing is hard-coded behind the
scenes. Duplicate one and every rule is there to be pulled apart, which is the
quickest way to learn the builder.

### Putting a system on a seat

Each strategy names the seats it can go on, in three states:

- **By hand** — no system; you place every bet yourself.
- **On call** — assigned, but it only bets when you press **Run** (or `S`).
- **Auto** — it places, presses and takes down its own bets after every roll.

Give seat B a system and you are playing against it. Give seat A one too and you
can sit two systems down against the same dice and watch the equity curves
separate. Because the dice run from a named seed, you can put the same seed up
twice and compare two strategies against identical rolls.

The **Strategy log** panel in the stats column records every call a system
makes, against the roll it made it on and the rule that made it — including the
ones the table refused, so a bot that quietly stops betting is never a mystery.

### Building your own

A rule is one sentence: **when** a moment arrives, **if** everything you name
about the table holds, **then** do these things.

- **When** — the come-out, the point being on, a new shooter, every roll, or the
  moment something happened: the point set or made, a seven out, a box number
  hitting, a craps, a natural.
- **If** — what you already have on a spot and how much of it, how many come
  bets are travelling, what the point is, which number just hit and how many
  times it has hit this hand, your rack, what you have at risk, how you are
  doing this hand or this session, how long the shooter has been rolling.
- **Then** — bet, take or lay odds, press, regress, take down, turn numbers on
  or off, or stop for the day.

Rules run top to bottom every time there is a chance to bet, and each one can be
limited to firing once per roll, per point, per shooter, or per session.

Two ideas do most of the work:

- **Amounts are in units.** A strategy carries a base unit and its rules bet in
  multiples of it, so the same system plays a $5 table and a $25 one. The
  engine's own increment rules do the rest — one $5 unit on the six goes up as
  six dollars, which is exactly how "one unit inside" arrives at **$22 inside**
  and two units at **$44 inside**, without either figure being written down
  anywhere.
- **The point** and **the number that just hit** are things a rule can name.
  "Press the number that hit by one unit" is an entire place-and-press system in
  one line, rather than six near-identical rules.

A bet names a *level*, not a helping: a rule that says "twenty-two inside" and
finds twenty-two inside already sitting there does nothing. That is what you
mean when you say it — the bets survive a point being made, and calling for them
again on the next come-out is a re-statement. Tick **on top** when you really do
want to add to what is there.

Set a **win goal** or a **loss limit** and the system colours up and stops on its
own. The builder flags rules that cannot do what they look like they do — a pass
line bet with the point on, a Fire Bet after the shooter has come out — and
strategies export and import as JSON, so you can pass one to someone else.

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
src/lib/strategy/   the strategy language, also pure
  types.ts          triggers, conditions, actions — a strategy is plain JSON
  run.ts            runStrategy: a table in, a table and a log of calls out
  library.ts        the seventeen house systems, in that same language
  describe.ts       a rule rendered back into the sentence you would have said
src/lib/store/      zustand: table + dice animation + strategies + preferences
src/components/     felt, chips, dice stage, HUD, controls
  Setup.tsx         the start screen and the new-session form, one component
  table/Fx.tsx      what the felt does when a roll resolves
  strategy/         the workshop and the rule builder
```

The engine has no React in it and no I/O. `applyRoll(table, roll)` returns a new
table, the settlements to animate, and a ledger record, which is what makes the
whole game replayable from a seed and testable without a browser.

`runStrategy` is the same shape one level up, and it moves money only by calling
the very legal-move functions the felt calls — so a bot cannot make a bet you
could not have made by hand, and a strategy can be played over ten thousand
seeded rolls in a test with no browser anywhere in sight.

## Tests

```bash
npm test           # 216 tests, about ten seconds
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

It also plays every one of the seventeen house strategies over a seeded
four-hundred-roll session and checks each one never overdraws a rack and never
invents a dollar: whatever a strategy does between rolls has to leave a seat
worth exactly what the settlements left it worth, because all it may do is move
chips between the rack and the felt.

`npm run test:stats` is the real proof: it plays hundreds of thousands of
decisions and checks the measured house edge lands where the mathematics says it
should — 1.41% on the pass line, 1.36% on don't pass, 2.78% on the field, 16.67%
on any seven, and around 0.37% on the pass line backed with full odds. It also
checks all 36 dice combinations come up flat over 600,000 rolls. Every run is
seeded, so it is deterministic rather than flaky; the tolerance bands are theory
plus or minus three standard errors. It takes a few minutes.

## How it ships

The game is client-side from top to bottom, so `npm run build` writes a folder
of static files (`out/`) rather than something that needs a Node process. The
Docker image builds that folder and then serves it from nginx, which is why it
is about 69 MB and has no npm packages in it to keep patched.

The practical consequence: anything that would need a server — a route handler,
a server action, saved sessions shared between devices — will fail the build
rather than quietly not work. Sessions live in the browser they were played in,
by design. [DEPLOY.md](DEPLOY.md) has the rest.
