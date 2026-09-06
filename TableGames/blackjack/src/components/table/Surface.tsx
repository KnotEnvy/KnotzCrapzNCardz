'use client';

/**
 * The table surface: the felt, and everything that sits on it.
 *
 * The felt is an SVG at a fixed viewBox. Everything that moves — cards, chips,
 * totals, settlement figures — is HTML positioned in the same coordinate
 * space, scaled by one transform on a wrapper. That split is deliberate: SVG
 * draws the print far better, and CSS animates a card flip far better, and
 * this is the seam that lets each do what it is good at while sharing one set
 * of coordinates.
 *
 * The scale is measured from the container rather than driven by CSS, because
 * the children need to know it: a card at 62px is right at full size and
 * illegible at a third of it, so the card size is a function of the scale
 * rather than a constant.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { CardFan } from './Card';
import { ChipStack } from './Chip';
import { Felt, DEALER_SPOT, FELT_H, FELT_W, SEAT_SPOTS, SHOE_SPOT, handSpot } from './Felt';
import { Shoe } from './Shoe';
import { displayTotal, handValue, isBlackjack } from '@/lib/engine/hand';
import { fmt, fmtSigned } from '@/lib/engine/money';
import { SIDE_BET_SPECS } from '@/lib/engine/sidebets';
import { enabledSideBets } from '@/lib/engine/sidebets';
import type { Hand, Seat, Settlement, SideBetKind, TableState } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Scaling
 * ------------------------------------------------------------------ */

/** Measure the container and report the scale from felt units to pixels. */
function useFeltScale(ref: React.RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // `contain`, not `cover`: the whole layout has to be on screen. A felt
      // with its betting circles cropped off is not a felt.
      setScale(Math.min(width / FELT_W, height / FELT_H));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return scale;
}

/* ------------------------------------------------------------------ *
 * Surface
 * ------------------------------------------------------------------ */

export function Surface({
  table,
  settlements,
  onSeatClick,
  onSideBetClick,
  className,
}: {
  table: TableState;
  settlements: readonly Settlement[];
  onSeatClick?: (seatIndex: number) => void;
  onSideBetClick?: (seatIndex: number, kind: SideBetKind) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const scale = useFeltScale(ref);
  const sideKinds = React.useMemo(() => enabledSideBets(table.rules.sideBets), [table.rules.sideBets]);

  return (
    <div ref={ref} className={cn('relative flex h-full w-full items-center justify-center', className)}>
      <div
        className="relative"
        style={{
          width: FELT_W * scale,
          height: FELT_H * scale,
        }}
      >
        <Felt rules={table.rules} />

        {/* Everything below is in felt units, scaled as one block. */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: FELT_W, height: FELT_H, transform: `scale(${scale})` }}
        >
          <Shoe shoe={table.shoe} x={SHOE_SPOT.x} y={SHOE_SPOT.y} />

          <DealerArea table={table} />

          {table.seats.map((seat, i) => (
            <SeatArea
              key={seat.id}
              seat={seat}
              index={i}
              table={table}
              settlements={settlements}
              sideKinds={sideKinds}
              onClick={() => onSeatClick?.(i)}
              onSideClick={(kind) => onSideBetClick?.(i, kind)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The dealer
 * ------------------------------------------------------------------ */

function DealerArea({ table }: { table: TableState }) {
  const { cards, holeDown } = table.dealer;
  const shown = holeDown ? cards.slice(0, 1) : cards;
  const v = handValue(shown);
  const natural = !holeDown && isBlackjack(cards);

  return (
    <div className="absolute -translate-x-1/2" style={{ left: DEALER_SPOT.x, top: DEALER_SPOT.y }}>
      <div className="flex flex-col items-center gap-1.5">
        {cards.length > 0 ? (
          <>
            <CardFan cards={cards} holeDown={holeDown} size={68} />
            <TotalPill
              label={holeDown ? displayTotal(shown) : displayTotal(cards)}
              tone={natural ? 'gold' : v.busted && !holeDown ? 'bad' : 'neutral'}
              suffix={natural ? 'blackjack' : !holeDown && handValue(cards).busted ? 'bust' : undefined}
            />
          </>
        ) : (
          <span
            className="text-[13px] tracking-[0.3em] text-white/25 uppercase"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Dealer
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A seat
 * ------------------------------------------------------------------ */

function SeatArea({
  seat,
  index,
  table,
  settlements,
  sideKinds,
  onClick,
  onSideClick,
}: {
  seat: Seat;
  index: number;
  table: TableState;
  settlements: readonly Settlement[];
  sideKinds: readonly SideBetKind[];
  onClick: () => void;
  onSideClick: (kind: SideBetKind) => void;
}) {
  const spot = SEAT_SPOTS[index];
  const hands = handSpot(index);
  const focused = table.focus?.seat === seat.id;
  const betting = table.phase === 'BETTING';

  if (!seat.occupied) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/15 px-4 py-3 text-[11px] tracking-[0.2em] text-white/30 uppercase transition-colors hover:border-brass-500/50 hover:text-brass-300"
        style={{ left: spot.x, top: spot.y, fontFamily: 'var(--font-display)' }}
      >
        Sit
      </button>
    );
  }

  return (
    <>
      {/* The hands. A split fans them out sideways from the seat's centre. */}
      <div
        className="absolute flex -translate-x-1/2 -translate-y-full items-end justify-center gap-3"
        style={{ left: hands.x, top: hands.y }}
      >
        {seat.hands.map((hand, i) => (
          <HandView
            key={hand.id}
            hand={hand}
            active={focused && table.focus?.hand === i}
            settlement={settlements.find((s) => s.seat === seat.id && s.handIndex === i)}
            compact={seat.hands.length > 2}
          />
        ))}
      </div>

      {/* The betting circle. */}
      <button
        type="button"
        onClick={onClick}
        disabled={!betting}
        aria-label={`${seat.name} betting circle, ${fmt(seat.pendingBet)}`}
        className={cn(
          'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-transform',
          betting && 'hover:scale-105',
          focused && 'focus-ring',
        )}
        style={{ left: spot.x, top: spot.y, width: 84, height: 84 }}
      >
        {seat.pendingBet > 0 || seat.hands.length > 0 ? (
          <ChipStack cents={seat.hands[0]?.bet ?? seat.pendingBet} size={30} />
        ) : betting ? (
          <span className="text-[10px] tracking-[0.2em] text-white/30 uppercase">Bet</span>
        ) : null}
      </button>

      {/* Insurance, beside the circle so it never sits under the cards. */}
      {seat.insurance > 0 ? (
        <div
          className="absolute -translate-x-full -translate-y-1/2 rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] whitespace-nowrap text-pit-100"
          style={{ left: spot.x - 52, top: spot.y }}
        >
          {seat.tookEvenMoney ? 'Even money' : `Ins ${fmt(seat.insurance)}`}
          {seat.insuranceNet !== null ? (
            <span className={seat.insuranceNet > 0 ? ' text-win' : ' text-lose'}>
              {' '}
              {fmtSigned(seat.insuranceNet)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* The side-bet circles, in a row under the main one. */}
      {sideKinds.length > 0 ? (
        /*
         * One row, however many the table books. Six boxes at this size come
         * to just over two hundred units, which is the widest a seat's column
         * can be before it reaches its neighbour's — the seats are 230 apart.
         * Wrapping to a second row was the alternative and it does not fit:
         * the felt's arc closes in fast below the betting circles, and an
         * outside seat's second row would hang over the rail.
         */
        <div
          className="absolute flex -translate-x-1/2 gap-[2px]"
          style={{ left: spot.x, top: spot.y + 46 }}
        >
          {sideKinds.map((kind) => {
            const wager = seat.pendingSideBets.find((sb) => sb.kind === kind);
            const spec = SIDE_BET_SPECS[kind];
            const settled = wager?.net ?? null;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onSideClick(kind)}
                disabled={!betting}
                title={`${spec.name} — ${spec.blurb} House edge ${spec.edge}%.`}
                aria-label={`${spec.name} side bet, ${fmt(wager?.amount ?? 0)}`}
                className={cn(
                  'sidebet-box relative flex h-[30px] w-[33px] flex-col items-center justify-center gap-px rounded border text-[7px] leading-none tracking-wide transition-colors',
                  wager
                    ? 'border-white/40 bg-black/50 text-white'
                    : 'border-white/12 bg-black/25 text-white/35',
                  betting && 'hover:border-white/50',
                  settled !== null && settled > 0 && 'border-win/70 bg-win/15 text-win',
                  settled !== null && settled < 0 && 'opacity-45',
                )}
                style={{ borderTopColor: wager ? spec.accent : undefined }}
              >
                <span style={{ fontFamily: 'var(--font-display)' }}>{spec.short}</span>
                {wager ? (
                  <span className="font-mono text-[8px]">{Math.round(wager.amount / 100)}</span>
                ) : null}
                {/*
                  A side bet that paid used to show only a green border. On a
                  hand where the main bet lost and Lucky Ladies hit for two
                  thousand dollars, the felt said nothing about the two
                  thousand dollars.
                */}
                {settled !== null && settled > 0 ? (
                  <span className="settle-chip pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded-full bg-win/20 px-1.5 py-px font-mono text-[10px] font-semibold whitespace-nowrap text-win">
                    {fmtSigned(settled)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* The nameplate, under everything. */}
      <div
        className="absolute -translate-x-1/2 text-center"
        style={{ left: spot.x, top: spot.y + (sideKinds.length > 0 ? 82 : 52) }}
      >
        <div
          className={cn(
            'text-[11px] tracking-[0.16em] uppercase',
            focused ? 'text-brass-300' : 'text-white/45',
          )}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {seat.name}
        </div>
        <div className="font-mono text-[11px] tabular-nums text-white/60">{fmt(seat.bankroll)}</div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One hand
 * ------------------------------------------------------------------ */

function HandView({
  hand,
  active,
  settlement,
  compact,
}: {
  hand: Hand;
  active: boolean;
  settlement?: Settlement;
  compact: boolean;
}) {
  const v = handValue(hand.cards);
  const natural = isBlackjack(hand.cards, hand.splitDepth);
  const size = compact ? 46 : 60;

  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1 rounded-lg p-1 transition-all',
        active && 'focus-ring bg-white/6 ring-1 ring-brass-400/50',
        hand.surrendered && 'opacity-40',
      )}
    >
      <CardFan cards={hand.cards} size={size} />

      <div className="flex items-center gap-1">
        <TotalPill
          label={displayTotal(hand.cards)}
          tone={natural ? 'gold' : v.busted ? 'bad' : active ? 'active' : 'neutral'}
          suffix={natural ? 'BJ' : v.busted ? 'bust' : undefined}
          small
        />
        {hand.doubled ? (
          <span className="rounded bg-brass-500/25 px-1 text-[9px] tracking-wider text-brass-300 uppercase">
            2x
          </span>
        ) : null}
        {hand.surrendered ? (
          <span className="rounded bg-white/10 px-1 text-[9px] tracking-wider text-pit-300 uppercase">
            surr
          </span>
        ) : null}
      </div>

      {settlement ? (
        <div
          className={cn(
            'settle-chip pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 font-mono text-xs font-semibold whitespace-nowrap tabular-nums',
            settlement.net > 0 && 'bg-win/20 text-win',
            settlement.net < 0 && 'bg-lose/20 text-lose',
            settlement.net === 0 && 'bg-push/20 text-push',
          )}
        >
          {fmtSigned(settlement.net)}
        </div>
      ) : null}
    </div>
  );
}

function TotalPill({
  label,
  tone,
  suffix,
  small,
}: {
  label: string;
  tone: 'neutral' | 'active' | 'bad' | 'gold';
  suffix?: string;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono tabular-nums',
        small ? 'text-[11px]' : 'text-[13px]',
        tone === 'neutral' && 'border-white/15 bg-black/45 text-pit-100',
        tone === 'active' && 'border-brass-400/60 bg-black/60 text-brass-300',
        tone === 'bad' && 'border-lose/50 bg-lose/15 text-lose',
        tone === 'gold' && 'border-brass-400/70 bg-brass-500/20 text-brass-300',
      )}
    >
      {label}
      {suffix ? <span className="text-[9px] tracking-wider uppercase opacity-80">{suffix}</span> : null}
    </span>
  );
}
