# Knotz Three Card Poker

Three Card Poker as the Strip deals it. Not a demo of it — the Ante and the
Play, Pair Plus, the Ante Bonus and the 6 Card Bonus, dealt by the procedure on
the regulator's own rule sheet, on seventeen real paytables — and the two things
a casino will never put on the felt: exactly what each of those paytables costs
you, and exactly what the fold you just made was worth.

A single deck through a shuffling machine every round, three seats sharing one
screen that still may not see each other's cards, and a dealer who needs a
queen to play.

```bash
pnpm install
pnpm run dev          # http://localhost:3000
```

## What is on the table

**Every bet.** The Ante, and the Play that matches it. Pair Plus, on its own or
beside an Ante. The Ante Bonus, paid on a played straight or better whatever
the dealer holds. The 6 Card Bonus, on the best five cards in your three and
the dealer's three.

**Every rule, from the rule sheet rather than from memory.** The machine
dispenses stacks of three: the first to the seat on the dealer's left, the
dealer's own last. The dealer qualifies with queen high. Ace-two-three is a
straight, and the *lowest* one — scoring it ace-high would make it the second
best in the game. A fold forfeits Pair Plus along with the Ante; a fold does
*not* forfeit the 6 Card Bonus, which needs an Ante under it to be placed at
all. Wagers settle in the sheet's order: Ante, Play, Pair Plus, 6 Card Bonus.
Two of those rules disagree between published sources, so both were settled
against a regulator's rule sheet and a casino's own rack card — see
[Sources](#sources).

**Every paytable that matters.** Eight Pair Plus tables, four Ante Bonus tables
and five 6 Card Bonus tables, each one real — listed in a published survey of
the game's paytables or printed on a casino's rack card — and five presets that
combine them, from the kindest table posted anywhere to the one to walk past.
The felt reprints its paytables from whatever is in force.

**A trainer that prices mistakes.** For the three cards in front of you it walks
every one of the 18,424 hands the dealer could be holding and tells you what
playing is worth against folding, in money. Grade your decisions and the panel
keeps a running total of the expected value your mistakes gave up — not "wrong",
but "that fold cost you $3.14".

**Three seats that play fair.** Nothing at this table is dealt face up. A seat's
cards turn over on its own turn and turn back after it decides; the dealer's
stay down until everyone has; then the dealer turns every hand, their own
first. Three seats on one screen could otherwise read each other's cards, and
knowing another hand moves the dealer's odds — which is exactly why players at
a real table may not share them.

## What the numbers say

Three Card Poker is small enough to solve outright. A player holds one of
22,100 hands, the dealer one of the 18,424 the rest of the deck can make, and
every one of those 407,170,400 pairings is equally likely. So **nothing this
game prints is estimated**. Every figure is a finite sum over those pairings, or
over the 20,358,520 six-card sets, and the test suite recomputes every constant
from nothing and holds each result against the published figure for the same
table. They agreed on every table, to the hundredth of a percent the published
figures are rounded to.

| Ante Bonus | House edge | Element of risk |
| --- | --- | --- |
| 5-4-1 | **3.373%** | 2.015% |
| 5-3-1 | 3.608% | 2.155% |
| 4-3-1 | 3.825% | 2.285% |
| 3-2-1 | 4.278% | 2.555% |

The **house edge** is per dollar Anted and the **element of risk** is per dollar
put on the felt, Play included. A perfect player plays 67.4% of hands, so the
two differ by that factor and both are true. The game prints both and names
both, because quoting one under the other's name is forty percent wrong.

| Pair Plus | House edge | | 6 Card Bonus | House edge |
| --- | --- | --- | --- | --- |
| 40-32-6-4-1 | 1.846% | | 1000-200-100-20-15-**9-8** | 6.741% |
| 40-30-6-4-1 | 2.317% | | 1000-200-100-20-15-10-7 | 8.561% |
| 35-33-6-4-1 | 2.697% | | 1000-200-50-25-20-10-5 | 10.225% |
| 40-25-6-4-1 | 3.493% | | 2000-200-50-25-15-10-5 | 14.356% |
| **200**-40-30-6-3-1 | 4.380% | | 1000-200-50-25-15-10-5 | 15.279% |
| 50-30-6-3-1 | 5.104% | | | |
| 40-30-5-4-1 | 5.575% | | | |
| 40-30-6-3-1 | 7.276% | | | |

Three things came out of the enumeration that were not what the first draft of
this game assumed.

**Q-6-4 is not a rule of thumb. It is the answer.** Every strategy card prints
"play Q-6-4 or better", and it reads like an approximation of something finer.
It is not: walked hand by hand, with each hand's own suits and the cards it
removes from the deck accounted for, the exact decision and the Q-6-4 line agree
on all 22,100 hands. `analysis.test.ts` asserts that the list of hands on which
they disagree is empty.

**A 200 to 1 mini royal line is worth three points.** It looks like decoration —
four hands in 22,100 — and it takes the most common Pair Plus table from 7.28%
to 4.38%, above three tables that pay a flush four. The first draft filed it
last.

**Trips paying eight beats trips paying seven, even at the straight's expense.**
Cutting the 6 Card Bonus's straight from ten to nine to pay three of a kind eight
looks like a trade and is almost two points in the player's favour, because
three of a kind turns up in six cards twice as often as a straight does.

The other ways of playing, at the usual 5-4-1 Ante Bonus:

| Strategy | Plays | House edge |
| --- | --- | --- |
| Q-6-4 or better — exactly the optimal strategy | 67.42% | 3.373% |
| Play whatever would qualify for the dealer | 69.59% | 3.449% |
| Never fold | 100% | 7.654% |

### Measured

The exact figures say what the game is worth. `pnpm run test:stats` deals it a
million times, through the same functions the buttons call, and checks that the
game on the felt is that game. Every band is computed from the run rather than
chosen:

| | measured | exact | band |
| --- | --- | --- | --- |
| Ante and Play, per Ante | 3.077% | 3.373% | ±0.492 (3σ) |
| Ante and Play, per unit of action | 1.838% | 2.015% | ±0.294 (3σ) |
| Pair Plus, 40-30-6-3-1 | 6.788% | 7.276% | ±0.862 (3σ) |
| 6 Card Bonus, 1000-…-10-7 | 9.399% | 8.561% | ±1.583 (3σ) |
| Hands played | 67.437% | 67.421% | ±0.188 (4σ) |
| Dealer qualifies | 69.565% | 69.593% | ±0.184 (4σ) |
| Never fold, 300,000 rounds | 7.564% | 7.654% | ±1.007 (3σ) |

Plus every one of the six three-card hands and the ten six-card hands at its
exact frequency. The frequencies are the tight part: a million deals place a
straight at 3.27% against an exact 3.26%, and six-card flushes at 1.014%
against 1.011%. The edges are the loose part, and have to be — Pair Plus pays
forty to one and the 6 Card Bonus a thousand, and those tails put a million
rounds' worth of 6 Card Bonus inside a band a point and a half wide. A measured
figure is a check that the engine deals the game the exact figure describes. It
is not a better figure than the exact one, and the game never prints it as one.

## Playing it

Space deals. `P` plays and `F` folds — and nothing plays or folds by default.
At the blackjack table Space stands, which is the safe answer on most hands.
Here neither answer is safe on most hands, and a key that decided for a player
who pressed it out of habit would be a key that costs money.

`C` opens the strategy card, `B` the paytables, `,` the house rules and `?` the
help. Click a spot to put the selected chip on it; click an empty seat to sit.

## How it is built

```
src/lib/engine/     pure game logic — no React, no clock, no randomness in use
  types.ts          cards, hands, wagers, seats, records. Plain data.
  rng.ts            xoshiro128** with rejection sampling
  deck.ts           the deck and the shuffling machine
  poker.ts          three-card scores, and the best five of six
  paytables.ts      seventeen real paytables, and what each line pays
  analysis.ts       the exact figures: counts, dealer odds, every edge
  rules.ts          presets, limits, and a table's figures
  table.ts          the state machine: every legal move on the table
  resolve.ts        settlement — the only thing that pays anybody
src/lib/strategy/
  strategy.ts       the exact play-or-fold answer, and grading against it
  autoplay.ts       the bot — plays through the same functions the buttons do
src/lib/store/      zustand; owns pacing, never owns rules
src/components/     the felt, the cards, the chips, the panels, the dialogs
tools/icons.mjs     the app icon and favicon, from analytic shapes
```

It is the blackjack table's architecture, deliberately, and much of its chrome
is a copy of that table's rather than a rewrite: the store's pacing and
persistence, the modal with its focus trap, the keyboard guard, the `Stat` that
speaks its tooltip, the audio mixer. Each of those was fixed by a round of
review at the table next door, and a copy starts where the fixes finished. What
changed is what a different game needs: a felt with stacked spots and printed
paytables, a shuffling machine instead of a shoe, cards that are never dealt
face up, and an engine that can solve its own game.

The engine is pure and the store is a metronome. Every money-moving call goes
through an engine function that returns either a new table or a refusal with a
sentence in it, which is what lets the bot, the measurement suite and the felt
share one rulebook.

## Working on it

```bash
pnpm test            # the fast suite — about five seconds
pnpm run typecheck   # run `pnpm run build` once first on a fresh clone
pnpm run lint        # zero errors, zero warnings; keep it that way
pnpm run test:stats  # a million rounds, and all 20 million six-card sets
```

The fast suite re-derives the three-card counts and the Ante and Play totals
over all 407 million pairings on every run. The six-card counts take ten
seconds to enumerate, so they live in the stats suite, and the fast suite
checks the six-card evaluator itself against a deliberately naive one instead.

`handoff.json` carries the architecture, the decisions worth knowing before
changing anything, and what is still open. Read it before touching the engine.

## Sources

- Rules and dealing procedure: the California Bureau of Gambling Control's
  published standards of play for Three Card Poker (Rev. 01/13) — hand rankings
  including "ace, 2, 3 is the lowest ranked straight", stacks of three from a
  shuffler, the Q-high qualifier, and "If a player has placed a Pair Plus
  wager, but does not make a Play wager, the player shall forfeit the wager".
- The 6 Card Bonus: Players Casino (Ventura) rack card, BGC ID GEGA-003036 —
  "A player shall only place a 6 Card Bonus wager if he/she has also placed an
  Ante wager", "shall not be forfeited if the player folds", and the
  1000-200-100-20-15-9-8 table.
- Paytables and the published edges the tests hold the enumeration against:
  the Wizard of Odds pages on Three Card Poker and its 6 Card Bonus.

Three Card Poker is a trademark of its owner, used here only to name the game.

## Running it as a container

```bash
docker compose up -d --build      # http://localhost:8083
```

Static build, nginx, no Node in production. `DEPLOY.md` covers the image, LAN
play on a phone, and the options for public hosting.
