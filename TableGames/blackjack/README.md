# Knotz Blackjack 21

A blackjack table. Not a demo of one — every bet a real table books, every rule
that changes what the game costs you, and the two things a casino will never
put on the felt: what each of those rules is worth, and whether the play you
just made was the right one.

Six decks in a shoe with a cut card you can watch coming, three seats sharing
one screen, splits to four hands, doubles, surrender, insurance, even money,
six side bets with their real paytables, and a dealer who has no choices at
all.

```bash
pnpm install
pnpm run dev          # http://localhost:3000
```

## What is on the table

**Every bet.** The wager, insurance at 2:1, even money on a natural against an
ace, and six side bets — Perfect Pairs, 21+3, Royal Match, Lucky Ladies, Super
Sevens and Bust It — each with its paytable and its house edge printed next to
it, because the honest way to offer a bad bet is to offer it with the number
attached.

**Every move.** Hit, stand, double (on any two cards or restricted to 9-11 or
10-11, with or without soft totals), split to four hands, re-split aces, hit
split aces, late surrender, early surrender. Each button knows why it is
unavailable and says so rather than sitting there dead — and each rule is
tested for doing something, not only for refusing correctly. Re-split aces
spent this game's first draft as a switch that priced itself at 0.08% and did
nothing at all.

**Every rule that matters.** One to eight decks, penetration on a slider,
dealer stands or hits soft 17, blackjack at 3:2 or 6:5, double after split,
American peek or European no-hole-card. Five presets — Single Deck, Vegas
Strip, Atlantic City, European, Liberal Shoe — and a custom column that prices
each switch as you flip it.

**A trainer.** Show the correct play before you act, with a sentence on why.
Or make the play and be graded against the chart afterwards. The chart itself
is in the game, built for the rules currently in force rather than a generic
one with footnotes.

**A card counter.** Hi-Lo, Knock-Out, Omega II and Hi-Opt II, with the running
count, the true count, the decks remaining and a betting ramp. It counts the
cards that have been turned face up, and nothing else: not the shoe, and not
the dealer's hole card, which leaves the shoe at the top of the round and is
not seen until the end of it. (It counted the hole card once. Three separate
places in this repository claimed otherwise while it did.)

## What the numbers say

The engine is measured, not asserted. `pnpm run test:stats` deals several
million rounds and compares what comes out against figures that have been
published for fifty years:

| | measured | published |
| --- | --- | --- |
| Dealer busts, six decks, S17 | 28.15% | 28.32% |
| Dealer busts, H17 | 28.52% | 28.54% |
| Player is dealt a natural | 4.78% | 4.749% |
| Vegas Strip house edge | 0.46% | 0.40% (model) |
| Mimicking the dealer instead | 5.64% | 5.5% |
| Flat bettor's hands at a true count of +2 or better | **+1.33% to the player** | |
| the same hands at −2 or worse | −2.17% | |

That last pair is the whole case for counting, and it is measured from the
player's own results rather than asserted: the same flat bet, the same chart,
bucketed by what the discard tray was saying when the chips went out.

Both bust figures count every round the dealer plays out, naturals included.
The 29.1% you will more often see quoted for H17 is conditioned on the dealer
*not* holding a natural — a different denominator, and citing it here made a
correct dealer look half a point wrong.

The last two lines are the argument: playing the chart costs you about a third
of a percent, and copying the dealer costs you five and a half. Every figure
above comes out of `pnpm run test:stats`, which runs 28 measurements in about
six minutes and prints the table.

The side bets are not measured — they are **enumerated**. Five of the six are
decided by two or three cards off the top of the shoe, so the suite walks every
ordered pair and triple, weights each by its exact probability, and sums the
payout. Those five edges carry no sampling error at all. Bust It is the
exception: it is a bet on a hand the dealer plays out, so it has to be dealt,
and its 400:1 tail gives it six times the main game's variance — half a million
rounds place it to within about a percent and no tighter, so it is quoted with
the uncertainty it has.

| Side bet | House edge, six decks |
| --- | --- |
| 21 + 3 | 4.62% |
| Perfect Pairs | 6.11% |
| Royal Match | 6.67% |
| Bust It | 6.9% ± 0.3 |
| Super Sevens | 11.40% |
| Lucky Ladies | 17.63% |

Against a main game that runs between 0.05% and 1.85% across the presets —
and 0.40% on the default table. That comparison is the argument, and it is why
the figures are on the chips.

## Playing it

Space deals, and then stands. `H` `S` `D` `P` `R` are hit, stand, double, split
and surrender; `N` declines insurance, `I` takes it, `E` takes even money. A
blackjack session is a hundred hands an hour and reaching for a mouse between
every one of them is what makes it feel like work.

Click an empty circle to sit down, a seated one to add a chip. Three seats,
each with its own bankroll and its own statistics.

## How it is built

```
src/lib/engine/     pure game logic — no React, no clock, no randomness in use
  types.ts          cards, hands, seats, rules, records. Plain data.
  rng.ts            xoshiro128** with rejection sampling
  shoe.ts           the shoe, the shuffle, the cut card
  hand.ts           totals, soft/hard, and what a hand may legally do
  rules.ts          five presets, and what every rule is worth
  sidebets.ts       six paytables, with computed edges
  table.ts          the state machine: every legal move on the table
  resolve.ts        settlement — the only thing that pays anybody
src/lib/strategy/
  basic.ts          the chart, per rule set, with fallbacks
  counting.ts       four counting systems and the index plays
  autoplay.ts       the bot — plays through the same functions the buttons do
src/lib/store/      zustand; owns pacing, never owns rules
src/components/     the felt, the cards, the chips, the panels
```

The felt comes in two geometries rather than one that scales. A blackjack
table needs about 520 units of depth — dealer's cards, three printed lines,
players' cards, circles, side-bet spots, nameplate — and a phone in landscape
has around 290 pixels of height once the header and buttons have taken theirs.
Scaling that shape left two thirds of the screen black, so the shallow
geometry drops to one printed line, moves the nameplate into the header's
territory and pulls the outside seats in from the rail. Both are the same set
of fields, so nothing downstream branches on which is in use.

The engine is pure and the store is a metronome. Every money-moving call goes
through an engine function that returns either a new table or a refusal with a
sentence in it, which is what lets the bot, the simulation and the felt share
one rulebook — a bot cannot make a bet a player could not, because there is no
second path into the state.

## Working on it

```bash
pnpm test            # the fast suite — 147 tests, about a second
pnpm run typecheck
pnpm run lint        # zero errors, zero warnings; keep it that way
pnpm run test:stats  # the long measurements: house edge, distributions, side bets
```

One thing worth knowing about the measurement suite before adding to it.
Blackjack's per-hand standard deviation is about 1.15 units, so the difference
between two 300,000-round runs carries a three-sigma band of 0.89% — wider than
double-after-split, late surrender, no-hole-card and a soft-17 dealer put
together. Resolving a 0.14% rule effect to a third of itself would take fifty
million rounds an arm. So the per-rule rows are printed as diagnostics, and
what is *asserted* for each rule is a frequency: how often the bot doubles,
splits or surrenders with it on versus off. Those converge in seconds, and they
are the only test shape that catches a rule wired to nothing — which is exactly
how re-split aces was found to be doing nothing.

`handoff.json` carries the architecture, the decisions worth knowing before
changing anything, and what is still open. Read it before touching the engine.

## Running it as a container

```bash
docker compose up -d --build      # http://localhost:8082
```

Static build, nginx, no Node in production. `DEPLOY.md` covers the image, LAN
play on a phone, and the options for public hosting.
