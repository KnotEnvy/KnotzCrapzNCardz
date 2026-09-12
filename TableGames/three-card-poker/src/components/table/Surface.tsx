'use client';

/**
 * The table surface: the felt, and everything that sits on it.
 *
 * The felt is an SVG at a fixed viewBox. Everything that moves — cards, chips,
 * the hand labels, the settlement figures — is HTML positioned in the same
 * coordinate space, scaled by one transform on a wrapper. The scale is measured
 * from the container rather than driven by CSS, because the geometry itself
 * changes shape on a short screen and the children have to know which one
 * they are in.
 *
 * The one rule this file enforces that no other does is **which cards are
 * face up**. Nothing at a Three Card Poker table is dealt face up. A player
 * turns their own hand to decide on it and turns it back; the dealer's hand
 * stays down until every decision is in; and then the dealer turns every hand
 * over, their own first and then the seats from their left. Three seats
 * sharing one screen could see each other's cards if this file let them — and
 * another seat's three cards move the dealer's odds, which is exactly why
 * players may not share them — so a seat's cards are up only while it is that
 * seat's turn, and at the showdown.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { HandFan } from './Card';
import { ChipStack } from './Chip';
import { Felt, geometryFor, spotCentre, type FeltGeometry, type SpotName } from './Felt';
import { Shuffler } from './Shuffler';
import { fmt, fmtSigned } from '@/lib/engine/money';
import { evaluate3, handName, qualifies } from '@/lib/engine/poker';
import type { Outcome, Seat, Settlement, SettlementKind, SpotKind, TableState } from '@/lib/engine/types';
import { SPOT_KEY } from '@/lib/engine/types';
import { seatDealDelay, seatRevealDelay, useGame, type Speed } from '@/lib/store/useGame';

/* ------------------------------------------------------------------ *
 * Scaling
 * ------------------------------------------------------------------ */

function useFelt(ref: React.RefObject<HTMLDivElement | null>): { g: FeltGeometry; scale: number } {
  const [box, setBox] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return React.useMemo(() => {
    const g = geometryFor(box.width, box.height);
    const scale = box.width === 0 ? 1 : Math.min(box.width / g.w, box.height / g.h);
    return { g, scale };
  }, [box]);
}

/* ------------------------------------------------------------------ *
 * Surface
 * ------------------------------------------------------------------ */

export function Surface({
  table,
  settlements,
  dealing,
  onSeatClick,
  onSpotClick,
  className,
}: {
  table: TableState;
  settlements: readonly Settlement[];
  /** True while the machine is delivering the round's stacks. */
  dealing: boolean;
  onSeatClick?: (seatIndex: number) => void;
  onSpotClick?: (seatIndex: number, spot: SpotKind) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { g, scale } = useFelt(ref);
  const speed = useGame((s) => s.prefs.speed);

  /*
   * The order hands were dealt in: seats in the round, left to right, and the
   * dealer last. Both the deal and the reveal are staggered by it, so the felt
   * and the store's timers agree about who goes when.
   */
  const order = React.useMemo(
    () => table.seats.filter((s) => s.cards.length === 3).map((s) => s.id),
    [table.seats],
  );

  return (
    <div ref={ref} className={cn('relative flex h-full w-full items-center justify-center', className)}>
      <div className="relative" style={{ width: g.w * scale, height: g.h * scale }}>
        <Felt rules={table.rules} g={g} />

        {/* Everything below is in felt units, scaled as one block. */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: g.w, height: g.h, transform: `scale(${scale})` }}
        >
          <Shuffler x={g.machine.x} y={g.machine.y} scale={g.machine.scale} busy={dealing} round={table.round} />
          <DealerArea table={table} g={g} dealDelay={seatDealDelay(order.length, speed)} />
          {table.seats.map((seat, i) => (
            <SeatArea
              key={seat.id}
              seat={seat}
              index={i}
              order={order.indexOf(seat.id)}
              speed={speed}
              dealing={dealing}
              table={table}
              g={g}
              settlements={settlements}
              onSit={() => onSeatClick?.(i)}
              onSpot={(spot) => onSpotClick?.(i, spot)}
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

function DealerArea({ table, g, dealDelay }: { table: TableState; g: FeltGeometry; dealDelay: number }) {
  const { cards, revealed } = table.dealer;
  const hand = cards.length === 3 ? evaluate3(cards) : null;
  const from = { x: g.machine.x - g.w / 2, y: g.machine.y - g.dealerY - 40 };

  return (
    <div className="absolute -translate-x-1/2" style={{ left: g.w / 2, top: g.dealerY }}>
      <div className="flex flex-col items-center gap-1.5">
        {cards.length === 3 ? (
          <>
            <HandFan
              key={table.round}
              cards={cards}
              down={!revealed}
              altBack={table.round % 2 === 1}
              size={g.dealerCard}
              dealDelay={dealDelay}
              flipStagger={90}
              from={from}
            />
            {revealed && hand ? (
              <span
                className={cn(
                  'sweep-in inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[12px] tabular-nums',
                  qualifies(hand) ? 'border-brass-400/60 bg-black/55 text-brass-300' : 'border-white/15 bg-black/45 text-pit-300',
                )}
                // After the cards have turned, not while they are still face down.
                style={{ animationDelay: '440ms' }}
              >
                {handName(hand)}
                <span className="text-[9px] tracking-wider uppercase opacity-80">
                  {qualifies(hand) ? 'qualifies' : 'does not qualify'}
                </span>
              </span>
            ) : (
              <span className="text-[10px] tracking-[0.24em] text-white/35 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
                Dealer
              </span>
            )}
          </>
        ) : (
          <span className="mt-8 text-[13px] tracking-[0.3em] text-white/25 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
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

/** Which settlements float over which printed spot. */
const FLOATS: Record<SpotName, readonly SettlementKind[]> = {
  ANTE: ['ANTE', 'ANTE_BONUS'],
  PLAY: ['PLAY'],
  PAIR_PLUS: ['PAIR_PLUS'],
  SIX_CARD: ['SIX_CARD'],
};

/** What fits under a hand on the felt. The long forms are in the announcer and the log. */
const SHORT_OUTCOME: Record<Outcome, string> = {
  WIN: 'Win',
  NO_QUALIFY: 'No qualifier',
  PUSH: 'Push',
  LOSE: 'Lose',
  FOLD: 'Folded',
};

const SPOT_LABEL: Record<SpotName, string> = {
  ANTE: 'Ante',
  PLAY: 'Play',
  PAIR_PLUS: 'Pair Plus',
  SIX_CARD: '6 Card Bonus',
};

function SeatArea({
  seat,
  index,
  order,
  speed,
  dealing,
  table,
  g,
  settlements,
  onSit,
  onSpot,
}: {
  seat: Seat;
  index: number;
  /** Position in the round's dealing order, or −1 when sitting out. */
  order: number;
  speed: Speed;
  dealing: boolean;
  table: TableState;
  g: FeltGeometry;
  settlements: readonly Settlement[];
  onSit: () => void;
  onSpot: (spot: SpotKind) => void;
}) {
  const chip = useGame((s) => s.prefs.chip);
  const anchor = g.seats[index];
  const betting = table.phase === 'BETTING';
  /*
   * Not focused while the machine is still dealing. The engine moves to
   * DECIDING the instant the deal is booked, and reading that alone turned the
   * first seat's cards face up while they were still in the air — a player
   * looking at a hand the dealer has not finished handing them.
   */
  const focused = table.phase === 'DECIDING' && table.focus === seat.id && !dealing;

  if (!seat.occupied) {
    /*
     * In the empty space where the seat's cards would be, not on its Ante
     * spot: at the anchor it landed on top of the printed ANTE diamond, and
     * an empty seat read as a diamond with two words in it.
     */
    return (
      <button
        type="button"
        onClick={onSit}
        disabled={!betting}
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/25 bg-black/30 px-4 py-2 text-[11px] tracking-[0.2em] text-white/45 uppercase transition-colors hover:border-brass-500/60 hover:text-brass-300 disabled:opacity-25"
        style={{ left: anchor.x, top: anchor.y + g.handBottom - g.seatCard * 0.5, fontFamily: 'var(--font-display)' }}
        aria-label={`Sit down at ${seat.name}`}
      >
        Sit
      </button>
    );
  }

  const dealtIn = seat.cards.length === 3;
  const folded = seat.decision === 'FOLD';
  /*
   * Up while the seat is deciding, and once the dealer is turning hands over.
   * A folded hand is turned at the showdown too, dimmed: a real dealer collects
   * a folded hand unseen, but a table with a trainer on it teaches more by
   * showing what the fold gave up.
   */
  const faceUp = dealtIn && (focused || table.phase === 'SETTLE');
  const hand = dealtIn ? evaluate3(seat.cards) : null;
  const cardsBottom = anchor.y + g.handBottom;
  const from = { x: g.machine.x - anchor.x, y: g.machine.y - cardsBottom + 60 };

  /** Chips on a spot: the bet before the deal, what is riding after it. */
  const amountOn = (spot: SpotName): number => {
    if (betting) return spot === 'PLAY' ? 0 : seat.bets[SPOT_KEY[spot]];
    // A fold hands the Ante and Pair Plus to the dealer on the spot. The 6 Card
    // Bonus is not forfeited and stays where it is.
    if (folded && (spot === 'ANTE' || spot === 'PAIR_PLUS')) return 0;
    return spot === 'PLAY' ? seat.wagers.play : seat.wagers[SPOT_KEY[spot]];
  };

  const booked = (spot: SpotName) =>
    spot === 'PAIR_PLUS' ? table.rules.pairPlus : spot === 'SIX_CARD' ? table.rules.sixCard : true;

  const label = seat.result
    ? `${seat.result.handName}${seat.result.outcome ? ` · ${SHORT_OUTCOME[seat.result.outcome]}` : ''}`
    : focused && hand
      ? handName(hand)
      : null;

  return (
    <>
      {dealtIn ? (
        <div
          className={cn(
            'absolute flex -translate-x-1/2 -translate-y-full flex-col items-center rounded-lg p-1',
            focused && 'focus-ring bg-white/6 ring-1 ring-brass-400/50',
          )}
          style={{ left: anchor.x, top: cardsBottom }}
        >
          <div className={cn(folded && table.phase !== 'DECIDING' && 'hand-folded')}>
            <HandFan
              key={table.round}
              cards={seat.cards}
              down={!faceUp}
              altBack={table.round % 2 === 1}
              size={g.seatCard}
              dealDelay={seatDealDelay(Math.max(0, order), speed)}
              // Turning a hand back down after a decision is immediate; turning
              // it up at the showdown waits for the dealer to reach this seat.
              flipBase={faceUp && table.phase === 'SETTLE' ? seatRevealDelay(Math.max(0, order), speed) : 0}
              flipStagger={70}
              from={from}
            />
          </div>
          {label ? (
            <span
              className={cn(
                'sweep-in absolute bottom-0 left-1/2 z-10 -translate-x-1/2 translate-y-1/2 rounded-full border px-2 py-px font-mono text-[10px] whitespace-nowrap tabular-nums',
                seat.result && seat.result.net > 0 && 'border-win/50 bg-[#062014]/90 text-win',
                seat.result && seat.result.net < 0 && 'border-lose/40 bg-[#1f0b0a]/90 text-lose',
                seat.result && seat.result.net === 0 && 'border-push/40 bg-black/80 text-push',
                !seat.result && 'border-brass-400/60 bg-black/75 text-brass-300',
              )}
            >
              {label}
            </span>
          ) : null}
        </div>
      ) : null}

      {(['SIX_CARD', 'PAIR_PLUS', 'ANTE', 'PLAY'] as const).map((spot) => {
        if (!booked(spot)) return null;
        const centre = spotCentre(g, index, spot);
        const amount = amountOn(spot);
        const floats = settlements.filter((s) => s.seat === seat.id && FLOATS[spot].includes(s.kind));
        const clickable = betting && spot !== 'PLAY';
        const size = spot === 'SIX_CARD' ? g.spotSize * 0.78 : g.spotSize;

        return (
          <div
            key={spot}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: centre.x, top: centre.y, width: size, height: size }}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onSpot(spot)}
                aria-label={`${seat.name} ${SPOT_LABEL[spot]}: ${fmt(amount)}. Add a ${fmt(chip)} chip.`}
                className="spot-hit absolute inset-0 rounded-full transition-transform hover:scale-110"
              />
            ) : null}
            {amount > 0 ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <ChipStack cents={amount} size={spot === 'SIX_CARD' ? g.chip * 0.82 : g.chip} />
              </div>
            ) : null}
            {floats.map((s, i) => {
              const side = g.floats[spot];
              // Positioned by a wrapper, animated inside it: the rise is a
              // transform, and a transform on the same element would replace
              // the one that centres it.
              const place: React.CSSProperties =
                side === 'below'
                  ? { top: size + 3 + i * 14, left: '50%', transform: 'translateX(-50%)' }
                  : side === 'left'
                    ? { right: size + 4, top: size / 2 - 9 + i * 15 }
                    : { left: size + 4, top: size / 2 - 9 + i * 15 };
              return (
                <div key={s.kind} className="pointer-events-none absolute z-20" style={place}>
                  <span
                    className={cn(
                      'settle-chip block rounded-full px-1.5 py-px font-mono text-[11px] font-semibold whitespace-nowrap tabular-nums',
                      s.net > 0 && 'bg-[#062014]/85 text-win',
                      s.net < 0 && 'bg-[#1f0b0a]/80 text-lose',
                      s.net === 0 && 'bg-black/60 text-push',
                    )}
                    title={s.label}
                  >
                    {s.kind === 'ANTE_BONUS' ? `bonus ${fmtSigned(s.net)}` : fmtSigned(s.net)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      {g.namePlate ? (
        <div
          className="absolute -translate-x-full -translate-y-1/2 text-right"
          style={{ left: anchor.x + g.namePlate.dx, top: anchor.y + g.namePlate.dy }}
        >
          <div
            className={cn('text-[11px] tracking-[0.16em] uppercase', focused ? 'text-brass-300' : 'text-white/50')}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {seat.name}
          </div>
          <div className="font-mono text-[11px] tabular-nums text-white/65">{fmt(seat.bankroll)}</div>
        </div>
      ) : null}
    </>
  );
}
