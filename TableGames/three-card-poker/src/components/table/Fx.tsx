'use client';

/**
 * Table juice: the layers that fire when a round settles.
 *
 * Everything here is read-only decoration: it is handed a table and the round's
 * settlements and draws what just happened, and it decides nothing about the
 * game. The one thing it reads from outside is the store's settlement clock,
 * for the reason given at `seatSweepDelay` — the dealer taking a losing bet is
 * three things at once, and only two of them are drawn here.
 *
 * It comes in two halves, and the split is physical rather than technical.
 * `FxUnder` is drawn inside the felt's own SVG, so it is *on the cloth*: the
 * printed spot lighting up, the qualifier line answering the question it asks,
 * a wash of light over the whole table. `FxOverlay` is HTML on the layer above
 * the cards and chips, so it is *over the table*: money crossing the felt, and
 * the burst at a hand that just made something. A flash that painted over the
 * chips sitting on the spot would look like a bug; a chip that flew under them
 * would look like nothing at all.
 *
 * All of it is CSS. There is no animation library in this game and adding one
 * to move a few chips would cost more than the chips are worth — every effect
 * below is a keyframe in `globals.css` driven by custom properties set here.
 * Each layer carries a `data-fx` hook so "the win flash fired" can be asserted
 * from outside React rather than inferred from a screenshot taken at the right
 * millisecond, which is exactly the class of bug a green build hides.
 *
 * Under `prefers-reduced-motion` the travel drops out entirely and the flashes
 * become plain cross-fades, which carry the same information without moving
 * anything across the screen. That rule is in the stylesheet, not here.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { ChipGlyph, stackBox } from './Chip';
import {
  payPoint,
  spotCentre,
  spotRadius,
  SPOT_SHAPE,
  tableShape,
  type FeltGeometry,
  type SpotName,
} from './layout';
import { fmt } from '@/lib/engine/money';
import { evaluate3, qualifies } from '@/lib/engine/poker';
import { seatSettleDelay, seatSweepDelay } from '@/lib/store/useGame';
import type { Settlement, SettlementKind, SixCardCategory, TableState } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * What just happened
 * ------------------------------------------------------------------ */

export interface SpotFlash {
  key: string;
  seat: number;
  spot: SpotName;
  win: boolean;
  delay: number;
  /**
   * When the dealer sweeps this spot's chips away, or null if nothing is taken
   * from it.
   *
   * A losing bet does not sit on the felt while the next one is placed — the
   * dealer takes it, and until now this table left it there until the round
   * cleared. Set only on a loss: a winner keeps their chips and a push is not
   * touched.
   */
  sweep: number | null;
}

export interface Flight {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  cents: number;
  win: boolean;
  delay: number;
}

export interface Burst {
  key: string;
  x: number;
  y: number;
  /** A hand worth a bonus, or one worth telling the pit about. */
  tone: 'gold' | 'jackpot';
  label: string;
  delay: number;
}

export interface TableFx {
  round: number;
  flashes: readonly SpotFlash[];
  flights: readonly Flight[];
  bursts: readonly Burst[];
  /** Light over the whole table. Reserved for the hands that deserve one. */
  wash: boolean;
  /** Whether the dealer's hand played, once it has been turned over. */
  qualifier: 'YES' | 'NO' | null;
}

export const NO_FX: TableFx = {
  round: -1,
  flashes: [],
  flights: [],
  bursts: [],
  wash: false,
  qualifier: null,
};

/** Which printed spot each kind of settlement belongs to. */
const SPOT_OF: Record<SettlementKind, SpotName> = {
  ANTE: 'ANTE',
  ANTE_BONUS: 'ANTE',
  PLAY: 'PLAY',
  PAIR_PLUS: 'PAIR_PLUS',
  SIX_CARD: 'SIX_CARD',
};

/** Beyond this many chips in the air at once it reads as confetti, not money. */
const MAX_FLIGHTS = 10;

/**
 * How long after the dealer's hand is turned the qualifier line answers.
 *
 * The cards take 420ms to turn and are staggered, which is the same number the
 * dealer's hand label waits for. The line has to speak after the hand is
 * readable, not while it is still edge-on.
 */
const TURN_MS = 460;

/** The three-card hands that pay an Ante Bonus, and the two that stop the pit. */
const BONUS_HANDS = new Set(['STRAIGHT', 'TRIPS', 'STRAIGHT_FLUSH']);
const LOUD_HANDS = new Set(['TRIPS', 'STRAIGHT_FLUSH']);
/** Six-card hands big enough to be worth a burst of their own. */
const LOUD_SIX = new Set<SixCardCategory>(['FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH']);

const SIX_LABEL: Partial<Record<SixCardCategory, string>> = {
  FOUR_OF_A_KIND: 'Four of a kind',
  STRAIGHT_FLUSH: '6-card straight flush',
  ROYAL_FLUSH: '6-card royal flush',
};

/**
 * Everything the felt should react to this round.
 *
 * Pure, and derived from state rather than fired as events, so a re-render in
 * the middle of an animation cannot produce a different set of effects than
 * the one already playing — the `key` each effect carries is stable for the
 * round, which is what lets React leave a running animation alone.
 */
export function deriveFx(table: TableState, settlements: readonly Settlement[], g: FeltGeometry): TableFx {
  const index = new Map(table.seats.map((s, i) => [s.id, i]));

  /* ---- the dealer's hand, once it is face up ---- */
  const dealer = table.dealer;
  const qualifier: TableFx['qualifier'] =
    dealer.revealed && dealer.cards.length === 3 ? (qualifies(evaluate3(dealer.cards)) ? 'YES' : 'NO') : null;

  if (!settlements.length) {
    return { ...NO_FX, round: table.round, qualifier };
  }

  /* ---- money, collapsed to one figure per spot ---- */
  const bySpot = new Map<string, { seat: number; spot: SpotName; net: number }>();
  for (const s of settlements) {
    const seat = index.get(s.seat);
    if (seat === undefined) continue;
    const spot = SPOT_OF[s.kind];
    const key = `${seat}-${spot}`;
    const prev = bySpot.get(key);
    // The Ante and its bonus share a spot, and two figures flashing the same
    // diamond is one event, not two.
    if (prev) prev.net += s.net;
    else bySpot.set(key, { seat, spot, net: s.net });
  }

  const flashes: SpotFlash[] = [];
  const flights: Flight[] = [];
  for (const [key, m] of bySpot) {
    // A push is neither, and lighting the box for one would say a bet resolved
    // when nothing moved. The figure on the spot already says "even".
    if (m.net === 0) continue;
    const delay = seatSettleDelay(m.seat);
    const win = m.net > 0;
    flashes.push({ key, seat: m.seat, spot: m.spot, win, delay, sweep: win ? null : seatSweepDelay(m.seat) });
    if (flights.length < MAX_FLIGHTS) {
      flights.push({
        key,
        from: spotCentre(g, m.seat, m.spot),
        // Winnings go out to the seat's own plate, where the bankroll is
        // printed; losses are raked in to the dealer's tray.
        to: win ? payPoint(g, m.seat) : g.bank,
        cents: Math.abs(m.net),
        win,
        delay: seatSweepDelay(m.seat),
      });
    }
  }

  /* ---- hands worth marking ---- */
  const bursts: Burst[] = [];
  let wash = false;
  for (const [i, seat] of table.seats.entries()) {
    const r = seat.result;
    if (!r) continue;
    const cardH = g.seatCard / 0.6944;
    const at = { x: g.seats[i].x, y: g.seats[i].y + g.handBottom - cardH * 0.5 };
    const delay = seatSettleDelay(i) + 120;

    // A hand the player gave up does not get a fanfare. The six card bonus is
    // the exception the rule sheet makes: it is settled whether the seat
    // folded or not, so a folded four of a kind still pays and still counts.
    const played = seat.decision !== 'FOLD';
    if (played && BONUS_HANDS.has(r.hand)) {
      const loud = LOUD_HANDS.has(r.hand);
      bursts.push({ key: `${i}-hand`, ...at, tone: loud ? 'jackpot' : 'gold', label: r.handName, delay });
      if (loud) wash = true;
    }
    if (r.sixCardHand && LOUD_SIX.has(r.sixCardHand)) {
      bursts.push({
        key: `${i}-six`,
        ...at,
        tone: 'jackpot',
        label: SIX_LABEL[r.sixCardHand] ?? r.sixCardHand,
        delay: delay + 260,
      });
      wash = true;
    }
  }

  return { round: table.round, flashes, flights, bursts, wash, qualifier };
}

/**
 * When the dealer takes the chips off a spot, or null if they stay.
 *
 * The felt asks this rather than reading the settlements again, so there is one
 * answer to "did this bet lose" and one clock for when the dealer gets there.
 */
export function sweepAt(fx: TableFx, seat: number, spot: SpotName): number | null {
  for (const f of fx.flashes) if (f.seat === seat && f.spot === spot) return f.sweep;
  return null;
}

/* ------------------------------------------------------------------ *
 * On the cloth
 * ------------------------------------------------------------------ */

/** The gradients and filters the effects paint with. Goes in the felt's defs. */
export function FxDefs() {
  return (
    <>
      {/* A win is light arriving and blooms wide; a loss is light being taken
          away and gets a third of the spread. Same construction, and you can
          tell the two apart from the corner of your eye without reading the
          colour — which is also what keeps them legible to a player who cannot
          tell the two colours apart at all. */}
      <filter id="fxGlow" x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="9" />
      </filter>
      <filter id="fxGlowTight" x="-45%" y="-45%" width="190%" height="190%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      {/* Warm light from over the table, for a hand that earned it. */}
      <radialGradient id="fxWash" cx="50%" cy="44%" r="72%">
        <stop offset="0%" stopColor="#ffe9a3" stopOpacity="0.30" />
        <stop offset="62%" stopColor="#d4af37" stopOpacity="0.10" />
        <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

const WIN_INK = '#4ade80';
const LOSE_INK = '#f87171';

/**
 * The printed spot a resolved bet was sitting in, lighting up.
 *
 * Drawn as the shape that is actually printed there — the circle, the diamond,
 * the box — because a rounded rectangle appearing over the Ante diamond reads
 * as a rendering fault rather than as the spot reacting.
 */
function FlashShape({
  g,
  flash,
  stroke,
  width,
  fill,
  filter,
  pad,
  opacity,
}: {
  g: FeltGeometry;
  flash: SpotFlash;
  stroke: string;
  width: number;
  fill: string;
  filter?: string;
  pad: number;
  /** A win paints its spot; a loss only outlines it. */
  opacity?: number;
}) {
  const c = spotCentre(g, flash.seat, flash.spot);
  const r = spotRadius(g, flash.spot) + pad;
  const shape = SPOT_SHAPE[flash.spot];
  const common = { fill, stroke, strokeWidth: width, filter, opacity };

  if (shape === 'circle') return <circle cx={c.x} cy={c.y} r={r} {...common} />;
  if (shape === 'diamond') {
    return (
      <polygon points={`${c.x},${c.y - r} ${c.x + r},${c.y} ${c.x},${c.y + r} ${c.x - r},${c.y}`} {...common} />
    );
  }
  const w = g.spotSize * 0.52 + pad;
  const h = g.spotSize * 0.4 + pad;
  return <rect x={c.x - w} y={c.y - h} width={w * 2} height={h * 2} rx={5 + pad} {...common} />;
}

/**
 * Everything that happens *on* the cloth: the spots reacting, the qualifier
 * line answering, and the wash.
 *
 * Rendered after the table's light rather than before it, because these are
 * light being added to the scene. Drawn under the light, a win at an outside
 * seat would be multiplied by the corner falloff and come out grey.
 */
export function FxUnder({ fx, g }: { fx: TableFx; g: FeltGeometry }) {
  return (
    <g pointerEvents="none">
      {fx.wash ? (
        <path
          key={`wash-${fx.round}`}
          d={tableShape(g, 0)}
          fill="url(#fxWash)"
          className="fx-wash"
          clipPath="url(#clothClip)"
          data-fx="wash"
        />
      ) : null}

      {fx.flashes.length ? (
        <g data-fx="flashes">
          {fx.flashes.map((f) => {
            const ink = f.win ? WIN_INK : LOSE_INK;
            const style = { animationDelay: `${f.delay}ms` } as React.CSSProperties;
            return (
              <g key={`${fx.round}-${f.key}`} className={f.win ? 'fx-flash-win' : 'fx-flash-lose'} style={style}>
                {/* A spot filled with red reads as a warning rather than as
                    money leaving, so a loss gets a fifth of the paint. */}
                <FlashShape g={g} flash={f} pad={2} fill={ink} stroke="none" width={0} opacity={f.win ? 0.2 : 0.08} />
                {/* The blurred copy is what makes it read as light on the
                    cloth rather than as paint on top of it. */}
                <FlashShape
                  g={g}
                  flash={f}
                  pad={2}
                  fill="none"
                  stroke={ink}
                  width={f.win ? 4 : 2.4}
                  filter={f.win ? 'url(#fxGlow)' : 'url(#fxGlowTight)'}
                />
                <FlashShape g={g} flash={f} pad={2} fill="none" stroke={ink} width={f.win ? 2.2 : 1.8} />
              </g>
            );
          })}
        </g>
      ) : null}

      {/*
        The qualifier line answering its own question.

        This is the one effect here that no other table in the arcade has, and
        it is the most useful: the single fact that decides every Ante and
        every Play is whether the dealer reached queen high, the felt already
        has that rule printed across it in gold, and until now the line just
        sat there while the answer was worked out somewhere else. Now it lights
        when the dealer plays and goes cold when they do not.
      */}
      {fx.qualifier ? (
        <text
          key={`q-${fx.round}-${fx.qualifier}`}
          className={cn('felt-text fx-qualifier', fx.qualifier === 'YES' ? 'fx-qualifier--yes' : 'fx-qualifier--no')}
          style={{ fontSize: g.lines[0].size, letterSpacing: '0.1em', animationDelay: `${TURN_MS}ms` }}
          data-fx={`qualifier-${fx.qualifier}`}
        >
          <textPath href="#arc-QUALIFIER" startOffset="50%">
            DEALER PLAYS WITH QUEEN HIGH OR BETTER
          </textPath>
        </text>
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Over the table
 * ------------------------------------------------------------------ */

/**
 * Money crossing the felt, and the burst at a hand that made something.
 *
 * HTML rather than SVG, positioned in the same felt units as the cards and the
 * chips, because this layer sits on top of them and because a chip in the air
 * has to be the same object as the chip that was on the spot.
 *
 * The chips are ghosts: the real bets are gone from the table by the time this
 * renders, which is why each flight carries its own origin rather than reading
 * one off a spot that is now empty.
 */
export function FxOverlay({ fx, g }: { fx: TableFx; g: FeltGeometry }) {
  if (!fx.flights.length && !fx.bursts.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      {fx.flights.length ? (
        <div data-fx="flights">
          {fx.flights.map((f) => {
            const r = g.chip * 0.42;
            const box = stackBox(f.cents, r);
            return (
              <div
                key={`${fx.round}-${f.key}`}
                className={cn('absolute', f.win ? 'fx-toss' : 'fx-rake')}
                style={
                  {
                    left: f.from.x,
                    top: f.from.y,
                    '--fx-dx': `${f.to.x - f.from.x}px`,
                    '--fx-dy': `${f.to.y - f.from.y}px`,
                    // Set as a custom property rather than as `animationDelay`,
                    // because the arc is two elements and the inner one has to
                    // start on the same frame. Custom properties inherit.
                    '--fx-delay': `${f.delay}ms`,
                  } as React.CSSProperties
                }
              >
                {/* A payoff is tossed and a loss is raked, and the two read
                    completely differently: one arcs over the layout, the other
                    slides flat across it. Same two endpoints, opposite
                    gesture — which is the inner element's job. */}
                <div className={f.win ? 'fx-toss__lift' : undefined}>
                  <svg
                    width={box.w}
                    height={box.h}
                    viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
                    className="block overflow-visible"
                    style={{ marginLeft: -box.w / 2, marginTop: box.minY }}
                  >
                    <ChipGlyph cents={f.cents} r={r} label={fmt(f.cents).replace('$', '')} />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {fx.bursts.map((b) => (
        <HandBurst key={`${fx.round}-${b.key}`} burst={b} />
      ))}
    </div>
  );
}

/** How many sparks fly off a burst. Beyond about twenty it reads as glitter. */
const SPARKS = 14;

/**
 * Spark geometry, derived from the index rather than drawn at random, for the
 * same reason the chip stacks are: this may re-render inside its own animation,
 * and a random spread would jump to a new one every time. The small per-index
 * skew is what keeps fourteen evenly spaced spokes from reading as a
 * mechanical star.
 */
function sparkAt(i: number) {
  return {
    deg: (360 * i) / SPARKS + (i % 3) * 7,
    reach: 52 + ((i * 37) % 30),
    delay: (i % 4) * 35,
  };
}

/** The moment a hand turns out to be worth something. */
function HandBurst({ burst }: { burst: Burst }) {
  const loud = burst.tone === 'jackpot';
  const ink = loud ? '#ffe9a3' : '#f2c14e';

  return (
    <div className="absolute" style={{ left: burst.x, top: burst.y }} data-fx={`burst-${burst.tone}`}>
      {/* The core going off. */}
      <div
        className="fx-burst-core absolute"
        style={
          {
            '--fx-ink': ink,
            animationDelay: `${burst.delay}ms`,
            width: loud ? 84 : 62,
            height: loud ? 84 : 62,
          } as React.CSSProperties
        }
      />
      {/* Two rings, offset in time, so the shock has a leading and a trailing
          edge instead of being one expanding circle. */}
      {[0, 1].map((k) => (
        <div
          key={k}
          className="fx-burst-ring absolute"
          style={
            {
              '--fx-ink': ink,
              animationDelay: `${burst.delay + k * 120}ms`,
              borderWidth: k ? 1.5 : 2.5,
              width: 44,
              height: 44,
            } as React.CSSProperties
          }
        />
      ))}
      {loud
        ? Array.from({ length: SPARKS }, (_, i) => {
            const sp = sparkAt(i);
            return (
              <div
                key={i}
                className="absolute"
                style={{ transform: `rotate(${sp.deg}deg)`, transformOrigin: '0 0' }}
              >
                <div
                  className="fx-burst-spark"
                  style={
                    {
                      '--fx-ink': ink,
                      '--fx-reach': `${sp.reach}px`,
                      animationDelay: `${burst.delay + sp.delay}ms`,
                    } as React.CSSProperties
                  }
                />
              </div>
            );
          })
        : null}
      {/* What it was. The felt says the hand name under the cards too, but
          that label is small, permanent and shared with every other round;
          this one is the announcement. */}
      <div
        className={cn('fx-burst-label absolute', loud && 'fx-burst-label--loud')}
        style={{ animationDelay: `${burst.delay + 60}ms` }}
      >
        {burst.label}
      </div>
    </div>
  );
}
