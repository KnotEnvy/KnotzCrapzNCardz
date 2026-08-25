'use client';

/**
 * The felt.
 *
 * One SVG holds the printed layout, every hitbox, and every chip, so the thing
 * you click and the thing you see can never disagree and the whole table scales
 * to any window without a single pixel measurement.
 */

import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { ChipStack } from './Chip';
import {
  AreaFlashes,
  ChipFlights,
  FxDefs,
  MoveTrails,
  OutcomeBurst,
  OutcomeWash,
  TRAVEL_MS,
} from './Fx';
import { PRINT_DIE_FACE, PRINT_DIE_PIP, PipPair } from './Pips';
import {
  AREAS,
  ROWS,
  VIEW,
  anchorFor,
  numberAnchors,
  numberZones,
  oddsAnchorFor,
  PROP_BOX,
  puckAnchor,
  seatOffset,
  type FeltArea,
  type Rect,
} from './layout';
import { FeltClip, SurfaceDefs, TableBed, TableLight } from './Surface';
import { placeEdge, placeOdds, formatRatio } from '@/lib/engine/odds';
import { canBet, canTakeDown, maxOddsFor, type BetSpec } from '@/lib/engine/table';
import { useGame, type NumberMode } from '@/lib/store/useGame';
import type { Bet, DieFace, PointNumber, SeatId } from '@/lib/engine/types';

const SEAT_RING: Record<SeatId, string> = { A: '#f0b429', B: '#38bdf8' };

/** How the armed number mode reads in a tooltip. */
const MODE_WORD: Record<NumberMode, string> = { PLACE: 'Place', BUY: 'Buy', LAY: 'Lay' };

/**
 * One clickable region of the felt.
 *
 * Most printed areas are a single zone, but a box number is three: the laid
 * money above the number, the number itself, and the right side below it. That
 * is how a real layout is divided and how a dealer reads it, so splitting the
 * cell removes the need to arm a mode before betting the side you meant.
 */
interface HitZone {
  id: string;
  rect: Rect;
  spec: BetSpec;
  area: FeltArea;
  /** Which side of the layout this zone belongs to; drives the hover tint. */
  tone: 'right' | 'dont';
  /** What the tooltip and the screen reader call it. */
  name: string;
}

/** Dice combinations printed next to each hardway. */
const HARD_PAIR: Record<number, DieFace> = { 4: 2, 6: 3, 8: 4, 10: 5 };
/** Dice combinations printed on the single-number props. */
const PROP_PAIR: Record<string, [DieFace, DieFace]> = {
  TWO: [1, 1],
  THREE: [1, 2],
  YO: [5, 6],
  TWELVE: [6, 6],
};

export function Felt({ onOpenHop }: { onOpenHop: () => void }) {
  const table = useGame((s) => s.table);
  const numberMode = useGame((s) => s.numberMode);
  const settlements = useGame((s) => s.settlements);
  const rolling = useGame((s) => s.rolling);
  const wager = useGame((s) => s.wager);
  const clearBet = useGame((s) => s.clearBet);
  const adjustOdds = useGame((s) => s.adjustOdds);
  const chip = useGame((s) => s.chip);

  /** Win / loss flashes keyed by the area a bet was sitting on. */
  const flashes = React.useMemo(() => {
    return settlements
      .filter((s) => s.type === 'WIN' || s.type === 'LOSE')
      .map((s) => ({ ...s, key: `${table.rollCount}-${s.betId}-${s.type}` }));
  }, [settlements, table.rollCount]);

  const lastRecord = table.history.length ? table.history[table.history.length - 1] : null;

  /*
   * A restored session arrives with its last roll already in the history, and
   * the reactions below are keyed on that roll. Without a mark of where this
   * sitting started, reopening the tab would replay the previous session's
   * finish: a gold wash, or the whole table shaking for a seven out that
   * happened yesterday. Everything from this roll index onward is live.
   */
  const [openingRoll] = React.useState(() => lastRecord?.index ?? -1);
  const settled = lastRecord && lastRecord.index !== openingRoll ? lastRecord : null;

  /*
   * A seven out knocks the table.
   *
   * Driven by animation controls fired from an effect rather than by a `key`
   * that remounts the felt: remounting would restart every chip's entrance
   * spring and re-run the whole layout, which is a lot of work to shake six
   * pixels. The roll index guard is the same one the table talk uses — the
   * effect runs on any history change, but a given roll may only shake once.
   */
  const shake = useAnimationControls();
  const reducedMotion = useReducedMotion() ?? false;
  const lastShaken = React.useRef(openingRoll);

  React.useEffect(() => {
    const rec = table.history[table.history.length - 1];
    if (!rec || rec.index === lastShaken.current) return;
    lastShaken.current = rec.index;
    if (rec.outcome !== 'SEVEN_OUT' || reducedMotion) return;
    void shake.start({
      x: [0, -11, 9, -6, 4, -2, 0],
      y: [0, 6, -4, 3, -2, 1, 0],
      transition: { duration: 0.55, ease: 'easeOut' },
    });
  }, [table.history, shake, reducedMotion]);

  /*
   * The two motions a chip on the felt can be in.
   *
   * `entrance` is a chip being put down; `travel` is a chip already on the
   * table being moved by the dealer. They are separate transitions on separate
   * nodes because motion drives both through style.transform and one node
   * cannot carry two of them — the same collision the spark wrapper avoids.
   *
   * Under reduced motion the entrance keeps only its fade and the travel snaps:
   * a bet appearing and a bet arriving are both information, but neither of
   * them needs to move across the screen to say so.
   */
  const entranceIn = reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: -26 };
  const entranceTo = reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };
  const entrance = reducedMotion
    ? ({ duration: 0.18, ease: 'easeOut' } as const)
    : ({ type: 'spring', stiffness: 420, damping: 26 } as const);
  const travel = reducedMotion
    ? ({ duration: 0 } as const)
    : // Slow enough to follow with the eye, and matched to the trail drawn
      // under it so the chip and its track finish together.
      ({ duration: TRAVEL_MS / 1000, ease: [0.32, 0.72, 0.28, 1] } as const);

  const handleZone = (zone: HitZone) => {
    if (zone.area.action === 'OPEN_HOP') {
      onOpenHop();
      return;
    }
    wager(zone.spec);
  };

  /*
   * Every clickable region on the felt, box numbers already split into their
   * three bands. Rebuilt only when the armed mode changes, because that is the
   * one thing outside the static geometry that a zone's meaning depends on.
   */
  const zones = React.useMemo<HitZone[]>(() => {
    const out: HitZone[] = [];
    for (const area of AREAS) {
      if (area.variant === 'number') {
        const n = area.spec.number as PointNumber;
        const z = numberZones(n);
        const word = n === 6 ? 'six' : n === 9 ? 'nine' : String(n);
        out.push(
          {
            id: `${area.id}-lay`,
            rect: z.lay,
            spec: { kind: 'LAY', number: n },
            area,
            tone: 'dont',
            name: `Lay the ${word}`,
          },
          {
            id: `${area.id}-mid`,
            rect: z.mid,
            spec: { kind: numberMode, number: n },
            area,
            tone: numberMode === 'LAY' ? 'dont' : 'right',
            name: `${MODE_WORD[numberMode]} the ${word}`,
          },
          {
            id: `${area.id}-place`,
            rect: z.place,
            spec: { kind: 'PLACE', number: n },
            area,
            tone: 'right',
            name: `Place the ${word}`,
          },
        );
        continue;
      }
      out.push({
        id: area.id,
        rect: area.rect,
        spec: area.spec,
        area,
        tone:
          area.spec.kind === 'DONT_PASS' || area.spec.kind === 'DONT_COME' ? 'dont' : 'right',
        name: area.callName ?? area.label,
      });
    }
    return out;
  }, [numberMode]);

  const betsFor = (predicate: (b: Bet) => boolean) => table.bets.filter(predicate);

  return (
    <motion.div className="h-full w-full" animate={shake}>
      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        className="h-full w-full"
        role="group"
        aria-label="Craps table layout"
      >
        <defs>
          <SurfaceDefs />
          <FeltClip />
          <filter id="printGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <FxDefs />
        </defs>

        {/* ---- Wood, bumper, cloth ---- */}
        <TableBed />

        {/* ---- Printed layout ---- */}
        <PrintedLayout />

        {/* ---- The lamp, and the dark it leaves in the corners ----
            Over the print rather than under it: screen-printed ink is lit and
            shaded along with the cloth it sits in, and a layout that stays
            uniformly bright while the felt falls away reads as a sticker. */}
        <TableLight />

        {/* ---- The ON / OFF puck ---- */}
        <Puck point={table.point} />

        {/* ---- Hitboxes ---- */}
        <g>
          {zones.map((zone) => {
            const avail = zone.area.action ? { allowed: true } : canBet(table, zone.spec);
            const blocked = !avail.allowed || rolling;
            return (
              <rect
                key={`hit-${zone.id}`}
                x={zone.rect.x}
                y={zone.rect.y}
                width={zone.rect.w}
                height={zone.rect.h}
                rx={zone.rect.rx ?? 4}
                className={
                  blocked ? 'hit hit--blocked' : `hit hit--${zone.tone === 'dont' ? 'dont' : 'right'}`
                }
                onClick={() => !blocked && handleZone(zone)}
                role="button"
                tabIndex={blocked ? -1 : 0}
                onKeyDown={(e) => {
                  if (blocked) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleZone(zone);
                  }
                }}
                aria-label={
                  blocked
                    ? `${zone.name} — ${avail.reason ?? 'dice are out'}`
                    : `Bet ${'$'}${chip} on ${zone.name}`
                }
              >
                <title>{blocked ? (avail.reason ?? 'Dice are out') : describeZone(zone)}</title>
              </rect>
            );
          })}
        </g>

        {/* ---- The boxes that just resolved, lit ---- */}
        <AreaFlashes settlements={settlements} rollId={table.rollCount} />

        {/* ---- The track a bet takes when it is moved to its number ----
            Under the chips, so the chip rides over its own trail. */}
        <MoveTrails settlements={settlements} rollId={table.rollCount} />

        {/* ---- Chips ---- */}
        <g>
          {betsFor(() => true).map((bet) => {
            const base = anchorFor(bet);
            const nudge = seatOffset(bet.seat);
            const at = { x: base.x + nudge.x, y: base.y + nudge.y };
            const odds = oddsAnchorFor(bet);
            const oddsAt = { x: odds.x + nudge.x, y: odds.y + nudge.y };
            const ring = SEAT_RING[bet.seat];
            const takeable = canTakeDown(bet).allowed;
            const maxOdds = maxOddsFor(table, bet);
            const oddsLabel =
              bet.kind === 'BUY' ? 'BUY' : bet.kind === 'LAY' ? 'LAY' : undefined;

            return (
              <g key={bet.id}>
                {/*
                  Two nested nodes on purpose. The outer one owns where the bet
                  *is*, so a come bet moved up to its number travels there
                  instead of teleporting; the inner one owns the chip being put
                  down. Both are transforms, and motion writes them through
                  style, so they cannot share a node.
                */}
                <motion.g
                  // Inert, and there for the same reason the effect layers
                  // carry data-fx: whether a bet actually travelled is a
                  // question you want to answer from outside React, by reading
                  // the transform back, rather than from a screenshot taken on
                  // the right millisecond.
                  data-chip={bet.id}
                  initial={{ x: at.x, y: at.y }}
                  animate={{ x: at.x, y: at.y }}
                  transition={travel}
                >
                  <motion.g initial={entranceIn} animate={entranceTo} transition={entrance}>
                    <ChipStack
                      x={0}
                      y={0}
                      amount={bet.amount}
                      r={20}
                      ring={ring}
                      off={!bet.working && ['PLACE', 'BUY', 'HARDWAY'].includes(bet.kind)}
                      label={oddsLabel}
                      title={[
                        table.seats[bet.seat].name,
                        maxOdds > 0 ? `click to add odds (max $${maxOdds})` : null,
                        takeable
                          ? 'right-click to take down'
                          : bet.odds > 0
                            ? 'right-click to pull the odds'
                            : 'contract bet, stays until it resolves',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (rolling) return;
                        if (maxOdds > 0) adjustOdds(bet.id, Math.min(maxOdds, bet.odds + chip));
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Contract bets refuse politely, and pull their odds
                        // down instead if any are riding.
                        if (!rolling) clearBet(bet.id);
                      }}
                    />
                  </motion.g>
                </motion.g>
                {bet.odds > 0 ? (
                  // Odds ride on top of the flat bet, so they follow it around
                  // the layout the same way.
                  <motion.g
                    initial={{ x: oddsAt.x, y: oddsAt.y }}
                    animate={{ x: oddsAt.x, y: oddsAt.y }}
                    transition={travel}
                  >
                    <motion.g
                      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                      transition={entrance}
                    >
                      <ChipStack
                        x={0}
                        y={0}
                        amount={bet.odds}
                        ring={ring}
                        r={15}
                        off={!bet.oddsWorking}
                        title={`Odds $${bet.odds} — right-click to take down`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!rolling) adjustOdds(bet.id, 0);
                        }}
                      />
                    </motion.g>
                  </motion.g>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* ---- Money leaving the layout ---- */}
        <ChipFlights settlements={settlements} rollId={table.rollCount} />

        {/* ---- Settlement flashes ---- */}
        <AnimatePresence>
          {flashes.map((f) => {
            // The settlement carries its own location, so a losing bet can still
            // be found on the felt after it has been swept away.
            const base = anchorFor(f.at);
            const nudge = seatOffset(f.seat);
            const at = { x: base.x + nudge.x, y: base.y + nudge.y };
            const win = f.type === 'WIN';
            return (
              <motion.g
                key={f.key}
                // The figure floats up off the chips it belongs to. Under
                // reduced motion it is printed where it would have ended up and
                // only fades, so it still clears the stack without travelling.
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 0, scale: 0.8 }}
                animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: -34, scale: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -52 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                pointerEvents="none"
              >
                <text
                  x={at.x}
                  y={at.y + (reducedMotion ? -34 : 0)}
                  textAnchor="middle"
                  fontSize={22}
                  fontWeight={800}
                  fill={win ? '#4ade80' : '#f87171'}
                  stroke="#04150d"
                  strokeWidth={4}
                  paintOrder="stroke fill"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {win ? `+${Math.round(f.net)}` : `-${Math.round(Math.abs(f.net))}`}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* ---- The table as a whole, reacting ---- */}
        <OutcomeWash record={settled} rollId={table.rollCount} />
        {/* Last, and over everything: the two events that end a hand. */}
        <OutcomeBurst record={settled} rollId={table.rollCount} />
      </svg>
    </motion.div>
  );
}

/**
 * The screen print.
 *
 * Memoised because it is derived entirely from module-level geometry: it takes
 * no props and can never change, which is what keeps the ink filter over it
 * from being re-rasterised behind every roll, chip and flash.
 */
const PrintedLayout = React.memo(function PrintedLayout() {
  return (
    <g pointerEvents="none" filter="url(#printInk)">
      {/* The proposition box, printed as a box. */}
      <rect
        x={PROP_BOX.x}
        y={PROP_BOX.y}
        width={PROP_BOX.w}
        height={PROP_BOX.h}
        rx={PROP_BOX.rx}
        fill="#01120b"
        opacity={0.42}
      />
      <rect
        x={PROP_BOX.x}
        y={PROP_BOX.y}
        width={PROP_BOX.w}
        height={PROP_BOX.h}
        rx={PROP_BOX.rx}
        fill="none"
        stroke="#f2ead8"
        strokeWidth={2}
        opacity={0.32}
      />
      {AREAS.map((area) => (
        <AreaArt key={`art-${area.id}`} area={area} />
      ))}
      <FieldArt />
      <DontPassArt />
    </g>
  );
});

/**
 * Tooltip text. Box numbers quote the house edge, because the whole point of
 * knowing place-6 pays 7:6 is knowing what that costs you. Each band of a box
 * number says what that band actually does, which is the whole reason for
 * splitting the cell up in the first place.
 */
function describeZone(zone: HitZone): string {
  const { area, spec } = zone;
  const n = spec.number as PointNumber | undefined;
  if (n !== undefined) {
    if (spec.kind === 'PLACE') {
      return `Place ${n} — pays ${formatRatio(placeOdds(n))}, house edge ${(placeEdge(n) * 100).toFixed(2)}%`;
    }
    if (spec.kind === 'BUY') {
      return `Buy the ${n} — true odds, less a five percent commission`;
    }
    if (spec.kind === 'LAY') {
      return `Lay the ${n} — true odds against, betting the seven comes first`;
    }
  }
  if (area.callName) {
    return `${area.callName}${area.sub && area.sub !== 'horn high' ? ` · ${area.sub}` : ''}`;
  }
  return `${area.label}${area.sub ? ` · ${area.sub}` : ''}`;
}

/* ------------------------------------------------------------------ *
 * Printed artwork per area
 * ------------------------------------------------------------------ */

function AreaArt({ area }: { area: FeltArea }) {
  const { rect, label, sub, variant } = area;
  const cx = rect.x + rect.w / 2;

  if (variant === 'number') {
    const n = area.spec.number as PointNumber;
    const a = numberAnchors(n);
    const z = numberZones(n);
    const word = n === 6 || n === 9;
    // Buying is only the better call on the four and the ten, so those are the
    // only two a real layout bothers to print it on.
    const buyable = n === 4 || n === 10;
    return (
      <g>
        {/* The don't side rides on a darker ground, which is the fastest way
            to read at a glance which half of the box you are pointing at. */}
        <rect x={z.lay.x} y={z.lay.y} width={z.lay.w} height={z.lay.h} rx={4} fill="#000814" opacity={0.2} />

        <rect
          x={rect.x + 3}
          y={rect.y + 3}
          width={rect.w - 6}
          height={rect.h - 6}
          rx={5}
          fill="none"
          stroke="#f2ead8"
          strokeWidth={2}
          opacity={0.85}
        />

        {/* Two hairlines divide the cell into the three bands a dealer works:
            laid money above, the number itself, the right side below. */}
        <line
          x1={rect.x + 9}
          y1={z.mid.y}
          x2={rect.x + rect.w - 9}
          y2={z.mid.y}
          stroke="#f2ead8"
          strokeWidth={1}
          opacity={0.28}
        />
        <line
          x1={rect.x + 9}
          y1={z.place.y}
          x2={rect.x + rect.w - 9}
          y2={z.place.y}
          stroke="#f2ead8"
          strokeWidth={1}
          opacity={0.28}
        />

        {/* Band captions. Chips land on top of these, exactly as they cover
            the print on a real table; they are here to teach an empty box. */}
        <text
          className="felt-text felt-text--muted felt-text--start"
          x={a.layLabel.x}
          y={a.layLabel.y}
          fontSize={9}
        >
          LAY
        </text>
        <text
          className="felt-text felt-text--muted felt-text--end"
          x={a.dcLabel.x}
          y={a.dcLabel.y}
          fontSize={9}
        >
          D/C
        </text>
        <text
          className="felt-text felt-text--muted felt-text--start"
          x={a.placeLabel.x}
          y={a.placeLabel.y}
          fontSize={9}
        >
          PLACE
        </text>
        <text
          className="felt-text felt-text--muted felt-text--end"
          x={a.comeLabel.x}
          y={a.comeLabel.y}
          fontSize={9}
        >
          COME
        </text>

        <text className="felt-num felt-num--box" x={a.glyph.x} y={a.glyph.y} fontSize={word ? 42 : 58}>
          {label}
        </text>
        <text className="felt-text felt-text--muted" x={a.odds.x} y={a.odds.y} fontSize={13}>
          {formatRatio(placeOdds(n))}
        </text>
        {buyable ? (
          <text
            className="felt-text felt-text--muted felt-text--start"
            x={a.buyLabel.x}
            y={a.buyLabel.y}
            fontSize={9}
          >
            BUY
          </text>
        ) : null}
      </g>
    );
  }

  if (variant === 'hard') {
    const n = area.spec.number as 4 | 6 | 8 | 10;
    const f = HARD_PAIR[n];
    return (
      <g>
        <rect
          x={rect.x + 3}
          y={rect.y + 3}
          width={rect.w - 6}
          height={rect.h - 6}
          rx={5}
          fill="rgba(0,0,0,0.16)"
          stroke="#f2ead8"
          strokeWidth={1.6}
          opacity={0.9}
        />
        <PipPair
          x={rect.x + 50}
          y={rect.y + 40}
          size={21}
          a={f}
          b={f}
          face={PRINT_DIE_FACE}
          pip={PRINT_DIE_PIP}
        />
        <text className="felt-text" x={rect.x + 126} y={rect.y + 30} fontSize={15}>
          {label}
        </text>
        <text className="felt-text felt-text--gold" x={rect.x + 126} y={rect.y + 52} fontSize={13}>
          {sub}
        </text>
      </g>
    );
  }

  if (variant === 'prop') {
    const pair = area.spec.prop ? PROP_PAIR[area.spec.prop] : undefined;
    // Any Seven and Any Craps are printed red, as they are on the felt.
    const red = area.spec.prop === 'ANY_7' || area.spec.prop === 'ANY_CRAPS';
    return (
      <g>
        <rect
          x={rect.x + 3}
          y={rect.y + 3}
          width={rect.w - 6}
          height={rect.h - 6}
          rx={5}
          fill="rgba(0,0,0,0.16)"
          stroke="#f2ead8"
          strokeWidth={1.4}
          opacity={0.85}
        />
        {pair ? (
          <>
            <PipPair
              x={cx}
              y={rect.y + 30}
              size={19}
              a={pair[0]}
              b={pair[1]}
              face={PRINT_DIE_FACE}
              pip={PRINT_DIE_PIP}
            />
            <text className="felt-text felt-text--gold" x={cx} y={rect.y + 64} fontSize={12}>
              {sub}
            </text>
          </>
        ) : (
          <>
            <text
              className={`felt-text${red ? ' felt-text--red' : ''}`}
              x={cx - 26}
              y={rect.y + rect.h / 2 - 8}
              fontSize={15}
            >
              {label}
            </text>
            <text
              className="felt-text felt-text--gold"
              x={cx - 26}
              y={rect.y + rect.h / 2 + 11}
              fontSize={11}
            >
              {sub}
            </text>
          </>
        )}
      </g>
    );
  }

  if (variant === 'hornhigh') {
    return (
      <g>
        <rect
          x={rect.x + 3}
          y={rect.y + 3}
          width={rect.w - 6}
          height={rect.h - 6}
          rx={5}
          fill="rgba(0,0,0,0.2)"
          stroke="#f2ead8"
          strokeWidth={1.3}
          opacity={0.8}
        />
        <text className="felt-text felt-text--muted" x={cx} y={rect.y + 17} fontSize={8}>
          HORN HIGH
        </text>
        <text className="felt-num felt-num--box" x={cx} y={rect.y + 36} fontSize={20}>
          {label}
        </text>
      </g>
    );
  }

  if (variant === 'side') {
    return (
      <g>
        <rect
          x={rect.x + 3}
          y={rect.y + 3}
          width={rect.w - 6}
          height={rect.h - 6}
          rx={5}
          fill="rgba(212,175,55,0.08)"
          stroke="#d4af37"
          strokeWidth={1.4}
          opacity={0.9}
        />
        <text className="felt-text felt-text--gold" x={cx} y={rect.y + 22} fontSize={rect.w < 80 ? 11 : 14}>
          {label}
        </text>
        <text className="felt-text felt-text--muted" x={cx} y={rect.y + 40} fontSize={9}>
          {sub}
        </text>
      </g>
    );
  }

  if (variant === 'small') {
    return (
      <g>
        <rect
          x={rect.x + 3}
          y={rect.y + 3}
          width={rect.w - 6}
          height={rect.h - 6}
          rx={5}
          fill="none"
          stroke="#f2ead8"
          strokeWidth={2}
          opacity={0.8}
        />
        <text className="felt-text" x={cx} y={rect.y + 34} fontSize={20}>
          {label}
        </text>
        <text className="felt-text felt-text--gold" x={cx} y={rect.y + 58} fontSize={13}>
          {sub}
        </text>
      </g>
    );
  }

  // Plain bands: come, don't come, pass line.
  const big = area.id === 'pass' || area.id === 'come';
  // The don't side is printed red on a real layout, and it is the single
  // cheapest way to stop a player backing the wrong end of the table.
  const dont = area.spec.kind === 'DONT_PASS' || area.spec.kind === 'DONT_COME';
  return (
    <g>
      <rect
        x={rect.x + 3}
        y={rect.y + 3}
        width={rect.w - 6}
        height={rect.h - 6}
        rx={(rect.rx ?? 4) + 2}
        fill={area.id === 'pass' ? 'rgba(255,255,255,0.03)' : 'none'}
        stroke="#f2ead8"
        strokeWidth={2}
        opacity={0.85}
      />
      <text
        className={`felt-text${dont ? ' felt-text--red' : ''}`}
        x={cx}
        y={rect.y + (big ? 40 : 34)}
        fontSize={big ? 30 : 19}
        style={{ letterSpacing: big ? '0.38em' : '0.16em' }}
      >
        {label}
      </text>
      {sub ? (
        <text
          className={`felt-text ${dont ? 'felt-text--red' : 'felt-text--muted'}`}
          x={cx}
          y={rect.y + (big ? 68 : 58)}
          fontSize={12}
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

/** The field prints its numbers, with the two and twelve ringed. */
function FieldArt() {
  const row = ROWS.field;
  const nums = [2, 3, 4, 9, 10, 11, 12];
  /*
   * Centred on the band and spread wide enough to own it. The old spacing was
   * narrower and pushed 44px to the right to clear the chip anchor, which left
   * the numbers visibly off-centre in a band that is mostly empty felt. At this
   * spacing the leftmost number still clears the chips by a wide margin.
   */
  const STEP = 104;
  const startX = 44 + 1106 / 2 - ((nums.length - 1) * STEP) / 2;
  return (
    <g pointerEvents="none">
      {nums.map((n, i) => {
        const x = startX + i * STEP;
        const special = n === 2 || n === 12;
        return (
          <g key={n}>
            {special ? (
              <circle cx={x} cy={row.y + 62} r={22} fill="none" stroke="#d4af37" strokeWidth={2} />
            ) : null}
            <text
              className={special ? 'felt-num felt-text--gold' : 'felt-num'}
              x={x}
              y={row.y + 62}
              fontSize={26}
              fill={special ? '#e8c455' : undefined}
            >
              {n}
            </text>
          </g>
        );
      })}
      <text className="felt-text felt-text--muted" x={startX} y={row.y + 92} fontSize={9}>
        PAYS DOUBLE
      </text>
      <text
        className="felt-text felt-text--muted"
        x={startX + (nums.length - 1) * STEP}
        y={row.y + 92}
        fontSize={9}
      >
        PAYS TRIPLE
      </text>
    </g>
  );
}

/** The barred twelve printed on the don't pass line. */
function DontPassArt() {
  const y = ROWS.bottom.y + ROWS.bottom.h / 2;
  const x = 44 + 216 + 60;
  return (
    <g pointerEvents="none">
      <text className="felt-num felt-text--red" x={x} y={y} fontSize={22} opacity={0.95}>
        12
      </text>
      <line x1={x - 20} y1={y} x2={x + 20} y2={y} stroke="#ef6a52" strokeWidth={2.5} opacity={0.95} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * The puck
 * ------------------------------------------------------------------ */

function Puck({ point }: { point: PointNumber | null }) {
  const target = puckAnchor(point);
  const on = point !== null;
  const reduced = useReducedMotion() ?? false;

  /*
   * The puck's two faces, and the turn between them.
   *
   * A dealer does not recolour the puck, they pick it up, turn it over and set
   * it down on the number — and that flip is the single loudest thing that
   * happens on a table between rolls. Keying the group on which face is showing
   * remounts it, so the new side arrives edge-on and opens out. That reads as a
   * turn without needing to animate a colour through the halfway point, and it
   * fires in both directions: on when the point is set, off when the hand ends.
   */
  const face = (
    <>
      <circle
        r={22}
        fill={on ? '#f4f4f2' : '#16181d'}
        stroke={on ? '#c9c9c2' : '#000'}
        strokeWidth={3}
      />
      <circle r={17} fill="none" stroke={on ? '#1f8a4c' : '#3a3a3a'} strokeWidth={2} />
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        y={1}
        fontSize={13}
        fontWeight={800}
        fill={on ? '#0b5136' : '#e6e9ef'}
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}
      >
        {on ? 'ON' : 'OFF'}
      </text>
    </>
  );

  return (
    <motion.g
      animate={{ x: target.x, y: target.y }}
      initial={false}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 24 }}
      pointerEvents="none"
      data-fx="puck"
    >
      <ellipse cx={0} cy={4} rx={23} ry={8} fill="#000" opacity={0.45} />
      {/* A live point breathing.
          The one piece of ambient motion tied to state rather than to time: it
          runs only while a point is on, so an idle table still has a pulse and
          a come-out is genuinely still. */}
      {on && !reduced ? (
        <motion.circle
          r={26}
          fill="none"
          stroke="#4ade80"
          strokeWidth={2}
          animate={{ opacity: [0.1, 0.32, 0.1], scale: [1, 1.07, 1] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}
      {/* The puck landing on a new number. Two rings offset in time rather than
          one, so the knock has a leading and a trailing edge — the wider,
          slower one is what carries a point being set across the table instead
          of leaving it a detail up in the corner. Keyed on the point so it
          replays once per point set and stays put for the rest of the cycle.
          Only in the ON direction: a hand ending already owns the wash, the
          burst and, on a seven out, the whole table. */}
      {on && !reduced
        ? [0, 1].map((k) => (
            <motion.circle
              key={`${point}-ring-${k}`}
              r={22}
              fill="none"
              stroke="#4ade80"
              strokeWidth={k ? 2 : 3}
              initial={{ scale: 1, opacity: k ? 0.45 : 0.85 }}
              animate={{ scale: k ? 3.6 : 2.7, opacity: 0 }}
              transition={{ duration: k ? 0.95 : 0.7, delay: k * 0.1, ease: 'easeOut' }}
            />
          ))
        : null}
      {reduced ? (
        <g>{face}</g>
      ) : (
        <motion.g
          key={on ? `on-${point}` : 'off'}
          initial={{ scaleY: 0.04, scaleX: 1.1, opacity: 0.5 }}
          animate={{ scaleY: 1, scaleX: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 17 }}
        >
          {face}
        </motion.g>
      )}
    </motion.g>
  );
}
