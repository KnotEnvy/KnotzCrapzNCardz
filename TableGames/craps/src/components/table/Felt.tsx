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
import { AreaFlashes, ChipFlights, FxDefs, OutcomeWash } from './Fx';
import { PipPair } from './Pips';
import {
  AREAS,
  ROWS,
  VIEW,
  anchorFor,
  numberAnchors,
  oddsAnchorFor,
  puckAnchor,
  seatOffset,
  type FeltArea,
} from './layout';
import { placeEdge, placeOdds, formatRatio } from '@/lib/engine/odds';
import { canBet, canTakeDown, maxOddsFor, type BetSpec } from '@/lib/engine/table';
import { useGame } from '@/lib/store/useGame';
import type { Bet, DieFace, PointNumber, SeatId } from '@/lib/engine/types';

const SEAT_RING: Record<SeatId, string> = { A: '#f0b429', B: '#38bdf8' };

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

  const handleArea = (area: FeltArea) => {
    if (area.action === 'OPEN_HOP') {
      onOpenHop();
      return;
    }
    let spec: BetSpec = area.spec;
    // The box numbers take whichever of place / buy / lay is armed.
    if (area.variant === 'number') {
      spec = { kind: numberMode, number: area.spec.number };
    }
    wager(spec);
  };

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
          <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b3b28" />
            <stop offset="45%" stopColor="#3a2418" />
            <stop offset="100%" stopColor="#1d120c" />
          </linearGradient>
          <radialGradient id="feltFill" cx="50%" cy="38%" r="78%">
            <stop offset="0%" stopColor="#126f4a" />
            <stop offset="55%" stopColor="#0b5136" />
            <stop offset="100%" stopColor="#05291b" />
          </radialGradient>
          <filter id="feltGrain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <filter id="printGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2d97e" />
            <stop offset="50%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#8a6f1c" />
          </linearGradient>
          <FxDefs />
        </defs>

        {/* Rail and felt */}
        <rect x={0} y={0} width={VIEW.w} height={VIEW.h} rx={26} fill="url(#wood)" />
        <rect
          x={14}
          y={14}
          width={VIEW.w - 28}
          height={VIEW.h - 28}
          rx={18}
          fill="url(#feltFill)"
          stroke="#0a3b27"
          strokeWidth={2}
        />
        <rect
          x={14}
          y={14}
          width={VIEW.w - 28}
          height={VIEW.h - 28}
          rx={18}
          filter="url(#feltGrain)"
          opacity={0.055}
          style={{ mixBlendMode: 'overlay' }}
          pointerEvents="none"
        />
        {/* Brass trim between rail and felt */}
        <rect
          x={10}
          y={10}
          width={VIEW.w - 20}
          height={VIEW.h - 20}
          rx={20}
          fill="none"
          stroke="url(#brass)"
          strokeWidth={2.5}
          opacity={0.55}
          pointerEvents="none"
        />

        {/* Divider between the player layout and the proposition box */}
        <line
          x1={1160}
          y1={40}
          x2={1160}
          y2={VIEW.h - 44}
          stroke="#f2ead8"
          strokeWidth={2}
          opacity={0.35}
        />

        {/* ---- Printed layout ---- */}
        <g pointerEvents="none">
          {AREAS.map((area) => (
            <AreaArt key={`art-${area.id}`} area={area} />
          ))}
          <FieldArt />
          <DontPassArt />
        </g>

        {/* ---- The ON / OFF puck ---- */}
        <Puck point={table.point} />

        {/* ---- Hitboxes ---- */}
        <g>
          {AREAS.map((area) => {
            const spec: BetSpec =
              area.variant === 'number' ? { kind: numberMode, number: area.spec.number } : area.spec;
            const avail = area.action ? { allowed: true } : canBet(table, spec);
            const blocked = !avail.allowed || rolling;
            return (
              <rect
                key={`hit-${area.id}`}
                x={area.rect.x}
                y={area.rect.y}
                width={area.rect.w}
                height={area.rect.h}
                rx={area.rect.rx ?? 4}
                fill="transparent"
                className={blocked ? 'hit hit--blocked' : 'hit'}
                onClick={() => !blocked && handleArea(area)}
                role="button"
                tabIndex={blocked ? -1 : 0}
                onKeyDown={(e) => {
                  if (blocked) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleArea(area);
                  }
                }}
                aria-label={
                  blocked
                    ? `${area.label} — ${avail.reason ?? 'dice are out'}`
                    : `Bet ${'$'}${chip} on ${area.label}`
                }
              >
                <title>{blocked ? (avail.reason ?? 'Dice are out') : describe(area, spec)}</title>
              </rect>
            );
          })}
        </g>

        {/* ---- The boxes that just resolved, lit ---- */}
        <AreaFlashes settlements={settlements} rollId={table.rollCount} />

        {/* ---- Chips ---- */}
        <g>
          {betsFor(() => true).map((bet) => {
            const base = anchorFor(bet);
            const nudge = seatOffset(bet.seat);
            const at = { x: base.x + nudge.x, y: base.y + nudge.y };
            const ring = SEAT_RING[bet.seat];
            const takeable = canTakeDown(bet).allowed;
            const maxOdds = maxOddsFor(table, bet);
            const oddsLabel =
              bet.kind === 'BUY' ? 'BUY' : bet.kind === 'LAY' ? 'LAY' : undefined;

            return (
              <g key={bet.id}>
                <motion.g
                  initial={{ opacity: 0, scale: 0.4, y: -26 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                >
                  <ChipStack
                    x={at.x}
                    y={at.y}
                    amount={bet.amount}
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
                      // Contract bets refuse politely, and pull their odds down
                      // instead if any are riding.
                      if (!rolling) clearBet(bet.id);
                    }}
                  />
                </motion.g>
                {bet.odds > 0 ? (
                  <motion.g
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                  >
                    <ChipStack
                      x={oddsAnchorFor(bet).x + nudge.x}
                      y={oddsAnchorFor(bet).y + nudge.y}
                      amount={bet.odds}
                      ring={ring}
                      r={12}
                      off={!bet.oddsWorking}
                      title={`Odds $${bet.odds} — right-click to take down`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!rolling) adjustOdds(bet.id, 0);
                      }}
                    />
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
                initial={{ opacity: 0, y: 0, scale: 0.8 }}
                animate={{ opacity: 1, y: -34, scale: 1 }}
                exit={{ opacity: 0, y: -52 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                pointerEvents="none"
              >
                <text
                  x={at.x}
                  y={at.y}
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
      </svg>
    </motion.div>
  );
}

/**
 * Tooltip text. Box numbers quote the house edge, because the whole point of
 * knowing place-6 pays 7:6 is knowing what that costs you.
 */
function describe(area: FeltArea, spec: BetSpec): string {
  if (area.variant === 'number' && spec.kind === 'PLACE') {
    const n = spec.number as PointNumber;
    return `Place ${n} — pays ${formatRatio(placeOdds(n))}, house edge ${(placeEdge(n) * 100).toFixed(2)}%`;
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
    const word = n === 6 || n === 9;
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
          opacity={0.85}
        />
        {/* A hairline splits the don't side above from the right side below. */}
        <line
          x1={rect.x + 10}
          y1={rect.y + 46}
          x2={rect.x + rect.w - 10}
          y2={rect.y + 46}
          stroke="#f2ead8"
          strokeWidth={1}
          opacity={0.22}
        />
        <text className="felt-text felt-text--muted" x={a.lay.x} y={rect.y + 14} fontSize={8}>
          LAY
        </text>
        <text className="felt-text felt-text--muted" x={a.dontCome.x} y={rect.y + 14} fontSize={8}>
          D/C
        </text>
        <text className="felt-num" x={a.glyph.x} y={a.glyph.y} fontSize={word ? 42 : 58}>
          {label}
        </text>
        <text className="felt-text felt-text--muted" x={a.odds.x} y={a.odds.y} fontSize={13}>
          {formatRatio(placeOdds(n))}
        </text>
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
        <PipPair x={rect.x + 48} y={rect.y + 30} size={20} a={f} b={f} />
        <text className="felt-text" x={rect.x + 124} y={rect.y + 22} fontSize={15}>
          {label}
        </text>
        <text className="felt-text felt-text--gold" x={rect.x + 124} y={rect.y + 42} fontSize={12}>
          {sub}
        </text>
      </g>
    );
  }

  if (variant === 'prop') {
    const pair = area.spec.prop ? PROP_PAIR[area.spec.prop] : undefined;
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
            <PipPair x={cx} y={rect.y + 22} size={18} a={pair[0]} b={pair[1]} />
            <text className="felt-text felt-text--gold" x={cx} y={rect.y + 80} fontSize={11}>
              {sub}
            </text>
          </>
        ) : (
          <>
            <text className="felt-text" x={cx - 26} y={rect.y + rect.h / 2 - 8} fontSize={15}>
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
        <text className="felt-text felt-text--muted" x={cx} y={rect.y + 56} fontSize={11}>
          {sub}
        </text>
      </g>
    );
  }

  // Plain bands: come, don't come, pass line.
  const big = area.id === 'pass' || area.id === 'come';
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
        className="felt-text"
        x={cx}
        y={rect.y + (big ? 40 : 34)}
        fontSize={big ? 30 : 19}
        style={{ letterSpacing: big ? '0.38em' : '0.16em' }}
      >
        {label}
      </text>
      {sub ? (
        <text className="felt-text felt-text--muted" x={cx} y={rect.y + (big ? 68 : 58)} fontSize={12}>
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
  const startX = 44 + 1106 / 2 - ((nums.length - 1) * 92) / 2 + 44;
  return (
    <g pointerEvents="none">
      {nums.map((n, i) => {
        const x = startX + i * 92;
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
        x={startX + (nums.length - 1) * 92}
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
      <text className="felt-num" x={x} y={y} fontSize={22} opacity={0.9}>
        12
      </text>
      <line x1={x - 20} y1={y} x2={x + 20} y2={y} stroke="#f2ead8" strokeWidth={2.5} opacity={0.9} />
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
  return (
    <motion.g
      animate={{ x: target.x, y: target.y }}
      initial={false}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      pointerEvents="none"
    >
      <ellipse cx={0} cy={4} rx={23} ry={8} fill="#000" opacity={0.45} />
      {/* The puck landing on a new number. Keyed on the point so it replays
          once per point set and stays put for the rest of the cycle. */}
      {on && !reduced ? (
        <motion.circle
          key={point}
          r={22}
          fill="none"
          stroke="#4ade80"
          strokeWidth={3}
          initial={{ scale: 1, opacity: 0.85 }}
          animate={{ scale: 2.7, opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      ) : null}
      <circle r={22} fill={on ? '#f4f4f2' : '#16181d'} stroke={on ? '#c9c9c2' : '#000'} strokeWidth={3} />
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
    </motion.g>
  );
}
