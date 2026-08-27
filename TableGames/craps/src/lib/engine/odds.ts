/**
 * Payout mathematics.
 *
 * Every ratio here is the real casino ratio, expressed as [numerator,
 * denominator] meaning "wins `numerator` for every `denominator` wagered".
 * Nothing in this file touches game state; it is a lookup layer that the
 * resolver and the UI both read from, so the odds shown on the felt and the
 * money actually paid can never drift apart.
 */

import type {
  AtsKind,
  Bet,
  DieFace,
  OddsScheme,
  PointNumber,
  PropKind,
  Roll,
  TableRules,
} from './types';

export type Ratio = readonly [number, number];

export function ratioValue(r: Ratio): number {
  return r[0] / r[1];
}

export function formatRatio(r: Ratio): string {
  return `${r[0]}:${r[1]}`;
}

/* ------------------------------------------------------------------ *
 * True odds (used for line odds and buy bets)
 * ------------------------------------------------------------------ */

export function trueOdds(n: PointNumber): Ratio {
  switch (n) {
    case 4:
    case 10:
      return [2, 1];
    case 5:
    case 9:
      return [3, 2];
    case 6:
    case 8:
      return [6, 5];
  }
}

/** Laying against a number is simply the inverse of taking true odds. */
export function layOdds(n: PointNumber): Ratio {
  const [a, b] = trueOdds(n);
  return [b, a];
}

/* ------------------------------------------------------------------ *
 * Commission
 * ------------------------------------------------------------------ */

/*
 * Buy and lay are the two bets that carry a vig, and they charge it on
 * different quantities. A buy pays true odds on the stake, so the commission
 * is five percent of the stake. A lay wins less than it risks, and the boxman
 * takes five percent of what it *wins* — $120 against the four wins $60 and
 * costs $3, not $6.
 *
 * Both live here rather than at the two call sites that need them. They used
 * to be duplicated: resolve.ts charged them correctly when the table takes the
 * vig on the win, while table.ts applied the buy formula to both when the vig
 * is taken up front, which charged a lay double on the four and ten. One rule,
 * one place.
 */

/** Five percent of the buy stake, rounded the way a boxman rounds it. */
export function buyVig(amount: number): number {
  return Math.max(1, Math.floor(amount * 0.05));
}

/** Five percent of what a lay actually wins. */
export function layVig(win: number): number {
  return Math.max(1, Math.floor(win * 0.05));
}

/** What a lay of `amount` against `n` stands to win, before commission. */
export function layWinnings(amount: number, n: PointNumber): number {
  return amount * ratioValue(layOdds(n));
}

/* ------------------------------------------------------------------ *
 * Place bets
 * ------------------------------------------------------------------ */

export function placeOdds(n: PointNumber): Ratio {
  switch (n) {
    case 4:
    case 10:
      return [9, 5];
    case 5:
    case 9:
      return [7, 5];
    case 6:
    case 8:
      return [7, 6];
  }
}

/** House edge on a place bet, for the tooltip that tells you the bad news. */
export function placeEdge(n: PointNumber): number {
  switch (n) {
    case 4:
    case 10:
      return 0.0667;
    case 5:
    case 9:
      return 0.04;
    case 6:
    case 8:
      return 0.0152;
  }
}

/* ------------------------------------------------------------------ *
 * Hardways
 * ------------------------------------------------------------------ */

export function hardwayOdds(n: 4 | 6 | 8 | 10): Ratio {
  return n === 4 || n === 10 ? [7, 1] : [9, 1];
}

/* ------------------------------------------------------------------ *
 * Propositions
 * ------------------------------------------------------------------ */

export const PROP_ODDS: Record<Exclude<PropKind, 'HORN' | 'HORN_HIGH_2' | 'HORN_HIGH_3' | 'HORN_HIGH_YO' | 'HORN_HIGH_12' | 'WORLD' | 'C_AND_E'>, Ratio> = {
  ANY_7: [4, 1],
  ANY_CRAPS: [7, 1],
  TWO: [30, 1],
  THREE: [15, 1],
  YO: [15, 1],
  TWELVE: [30, 1],
};

/** The single-number payout used inside horn, world and C&E splits. */
function hornLegOdds(total: number): Ratio {
  return total === 2 || total === 12 ? [30, 1] : [15, 1];
}

/* ------------------------------------------------------------------ *
 * Hop bets
 * ------------------------------------------------------------------ */

export function hopOdds(a: DieFace, b: DieFace): Ratio {
  return a === b ? [30, 1] : [15, 1];
}

/* ------------------------------------------------------------------ *
 * Field
 * ------------------------------------------------------------------ */

export function fieldOdds(total: number, rules: TableRules): Ratio | null {
  switch (total) {
    case 2:
      return rules.fieldPays3OnTwo ? [3, 1] : [2, 1];
    case 12:
      return rules.fieldPays3OnTwelve ? [3, 1] : [2, 1];
    case 3:
    case 4:
    case 9:
    case 10:
    case 11:
      return [1, 1];
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Side bets
 * ------------------------------------------------------------------ */

/** Fire bet, by number of unique points made before the seven-out. */
export function fireOdds(uniquePoints: number): Ratio | null {
  switch (uniquePoints) {
    case 4:
      return [24, 1];
    case 5:
      return [249, 1];
    case 6:
      return [999, 1];
    default:
      return null;
  }
}

export const ATS_NUMBERS: Record<AtsKind, number[]> = {
  SMALL: [2, 3, 4, 5, 6],
  TALL: [8, 9, 10, 11, 12],
  ALL: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
};

export function atsOdds(kind: AtsKind): Ratio {
  return kind === 'ALL' ? [150, 1] : [30, 1];
}

/* ------------------------------------------------------------------ *
 * Maximum odds behind the line
 * ------------------------------------------------------------------ */

function oddsMultiplier(point: PointNumber, scheme: OddsScheme): number {
  switch (scheme) {
    case '1x':
      return 1;
    case '2x':
      return 2;
    case '3-4-5':
      return point === 4 || point === 10 ? 3 : point === 5 || point === 9 ? 4 : 5;
    case '5x':
      return 5;
    case '10x':
      return 10;
    case '20x':
      return 20;
    case '100x':
      return 100;
  }
}

/** Largest odds bet allowed behind a pass or come bet. */
export function maxPassOdds(flat: number, point: PointNumber, scheme: OddsScheme): number {
  return Math.floor(flat * oddsMultiplier(point, scheme));
}

/**
 * Largest lay allowed behind a don't pass or don't come bet. Casinos cap the
 * don't side by the amount you can *win*, matching the right-side maximum.
 */
export function maxLayOdds(flat: number, point: PointNumber, scheme: OddsScheme): number {
  const [num, den] = trueOdds(point);
  // A lay of L wins L * den/num, so to win `maxWin` you must lay maxWin * num/den.
  const maxWin = maxPassOdds(flat, point, scheme) * (num / den);
  return Math.floor(maxWin * (num / den) + 1e-9);
}

/* ------------------------------------------------------------------ *
 * Dealer-friendly bet increments
 * ------------------------------------------------------------------ */

/**
 * The unit a wager should be a multiple of so the dealer can pay it exactly.
 * Place 6 and 8 pay 7:6, so they want multiples of six, and so on.
 */
export function betIncrement(bet: Pick<Bet, 'kind' | 'number' | 'prop'>): number {
  switch (bet.kind) {
    case 'PLACE':
      if (bet.number === 6 || bet.number === 8) return 6;
      if (bet.number === 5 || bet.number === 9) return 5;
      return 5;
    case 'BUY':
    case 'LAY':
      return 5;
    case 'PROP':
      if (bet.prop === 'HORN' || bet.prop === 'WORLD') {
        return bet.prop === 'HORN' ? 4 : 5;
      }
      if (bet.prop === 'C_AND_E') return 2;
      if (bet.prop?.startsWith('HORN_HIGH')) return 5;
      return 1;
    default:
      return 1;
  }
}

/**
 * Rounds a wager up to a payable multiple, never below one increment.
 *
 * Up rather than down: a player dropping a $25 chip on the six means "at least
 * this much", and a dealer takes the extra dollar rather than handing five
 * back. So $25 on the six becomes $30, $5 becomes $6, $100 becomes $102 — and
 * the payout divides evenly either way. `snapDownToIncrement` is the fallback
 * for a rack that cannot cover the difference.
 */
export function snapToIncrement(amount: number, increment: number): number {
  if (increment <= 1) return Math.max(0, Math.ceil(amount));
  const snapped = Math.ceil(amount / increment) * increment;
  return snapped < increment ? increment : snapped;
}

/** The other direction, used only when rounding up would overdraw the rack. */
export function snapDownToIncrement(amount: number, increment: number): number {
  if (increment <= 1) return Math.max(0, Math.floor(amount));
  const snapped = Math.floor(amount / increment) * increment;
  return snapped < increment ? increment : snapped;
}

/**
 * What a chip off the rack is actually worth on a given spot.
 *
 * Chips come in fives. The six and the eight pay 7:6 and so are bet in sixes,
 * which is why nobody at a real table says "twenty-five on the six" and means
 * twenty-five — they mean five units, and five units of six is thirty. Same
 * conversion all the way up: a nickel is $6, a quarter is $30, a black is $120.
 *
 * Only chip-denominated wagers go through here. A press adds one increment and
 * a power press doubles what is already there, and both of those are stated in
 * the spot's own units already — running them through this would inflate them.
 */
export function chipToWager(bet: Pick<Bet, 'kind' | 'number' | 'prop'>, chip: number): number {
  const inc = betIncrement(bet);
  if (inc <= 1) return Math.max(0, Math.ceil(chip));
  if (inc === 6) return Math.max(inc, Math.round(chip / 5) * 6);
  return snapToIncrement(chip, inc);
}

/* ------------------------------------------------------------------ *
 * The single entry point the resolver uses
 * ------------------------------------------------------------------ */

export interface Payout {
  /** Winnings on top of the returned stake. */
  win: number;
  /** Commission owed to the house on this win. */
  vig: number;
  /** Portion of the stake that is returned rather than won (horn/world legs). */
  pushed: number;
}

const NO_PAYOUT: Payout = { win: 0, vig: 0, pushed: 0 };

/**
 * Winnings for a proposition bet on a given roll. Multi-leg bets (horn, world,
 * C&E) split the stake across their legs and lose the legs that miss.
 */
export function propPayout(prop: PropKind, amount: number, roll: Roll): Payout {
  const t = roll.total;
  const one = (ratio: Ratio): Payout => ({ win: amount * ratioValue(ratio), vig: 0, pushed: 0 });

  switch (prop) {
    case 'ANY_7':
      return t === 7 ? one(PROP_ODDS.ANY_7) : NO_PAYOUT;
    case 'ANY_CRAPS':
      return t === 2 || t === 3 || t === 12 ? one(PROP_ODDS.ANY_CRAPS) : NO_PAYOUT;
    case 'TWO':
      return t === 2 ? one(PROP_ODDS.TWO) : NO_PAYOUT;
    case 'THREE':
      return t === 3 ? one(PROP_ODDS.THREE) : NO_PAYOUT;
    case 'YO':
      return t === 11 ? one(PROP_ODDS.YO) : NO_PAYOUT;
    case 'TWELVE':
      return t === 12 ? one(PROP_ODDS.TWELVE) : NO_PAYOUT;

    case 'HORN': {
      if (![2, 3, 11, 12].includes(t)) return NO_PAYOUT;
      const leg = amount / 4;
      return { win: leg * ratioValue(hornLegOdds(t)) - leg * 3, vig: 0, pushed: leg };
    }

    case 'HORN_HIGH_2':
    case 'HORN_HIGH_3':
    case 'HORN_HIGH_YO':
    case 'HORN_HIGH_12': {
      if (![2, 3, 11, 12].includes(t)) return NO_PAYOUT;
      const highNumber =
        prop === 'HORN_HIGH_2' ? 2 : prop === 'HORN_HIGH_3' ? 3 : prop === 'HORN_HIGH_YO' ? 11 : 12;
      // Five units: two on the high number, one on each of the other three.
      const unit = amount / 5;
      const staked = t === highNumber ? unit * 2 : unit;
      const lost = amount - staked;
      return { win: staked * ratioValue(hornLegOdds(t)) - lost, vig: 0, pushed: staked };
    }

    case 'WORLD': {
      const unit = amount / 5;
      if (t === 7) return { win: 0, vig: 0, pushed: amount }; // the seven leg makes it a push
      if (![2, 3, 11, 12].includes(t)) return NO_PAYOUT;
      return { win: unit * ratioValue(hornLegOdds(t)) - unit * 4, vig: 0, pushed: unit };
    }

    case 'C_AND_E': {
      const half = amount / 2;
      if (t === 2 || t === 3 || t === 12) {
        return { win: half * ratioValue(PROP_ODDS.ANY_CRAPS) - half, vig: 0, pushed: half };
      }
      if (t === 11) {
        return { win: half * ratioValue(PROP_ODDS.YO) - half, vig: 0, pushed: half };
      }
      return NO_PAYOUT;
    }
  }
}

/** Human-readable name for a bet, used on chips, the ledger and tooltips. */
export function betLabel(bet: Bet): string {
  switch (bet.kind) {
    case 'PASS':
      return bet.number ? `Pass Line (${bet.number})` : 'Pass Line';
    case 'DONT_PASS':
      return bet.number ? `Don't Pass (${bet.number})` : "Don't Pass";
    case 'COME':
      return bet.number ? `Come ${bet.number}` : 'Come';
    case 'DONT_COME':
      return bet.number ? `Don't Come ${bet.number}` : "Don't Come";
    case 'PLACE':
      return `Place ${bet.number}`;
    case 'BUY':
      return `Buy ${bet.number}`;
    case 'LAY':
      return `Lay ${bet.number}`;
    case 'BIG':
      return `Big ${bet.number}`;
    case 'HARDWAY':
      return `Hard ${bet.number}`;
    case 'FIELD':
      return 'Field';
    case 'PROP':
      return PROP_LABELS[bet.prop!] ?? 'Proposition';
    case 'HOP':
      return `Hop ${bet.hop![0]}-${bet.hop![1]}`;
    case 'FIRE':
      return 'Fire Bet';
    case 'ATS':
      return bet.ats === 'ALL' ? 'All' : bet.ats === 'TALL' ? 'Tall' : 'Small';
  }
}

export const PROP_LABELS: Record<PropKind, string> = {
  ANY_7: 'Any Seven',
  ANY_CRAPS: 'Any Craps',
  TWO: 'Aces',
  THREE: 'Ace Deuce',
  YO: 'Yo Eleven',
  TWELVE: 'Boxcars',
  HORN: 'Horn',
  HORN_HIGH_2: 'Horn High Aces',
  HORN_HIGH_3: 'Horn High Three',
  HORN_HIGH_YO: 'Horn High Yo',
  HORN_HIGH_12: 'Horn High Twelve',
  WORLD: 'World',
  C_AND_E: 'C & E',
};

/** Odds text shown on the felt next to each betting area. */
export function oddsText(bet: Pick<Bet, 'kind' | 'number' | 'prop' | 'hop' | 'ats'>): string {
  switch (bet.kind) {
    case 'PLACE':
      return formatRatio(placeOdds(bet.number as PointNumber));
    case 'BUY':
      return `${formatRatio(trueOdds(bet.number as PointNumber))} less 5%`;
    case 'LAY':
      return `${formatRatio(layOdds(bet.number as PointNumber))} less 5%`;
    case 'HARDWAY':
      return formatRatio(hardwayOdds(bet.number as 4 | 6 | 8 | 10));
    case 'HOP':
      return formatRatio(hopOdds(bet.hop![0], bet.hop![1]));
    case 'ATS':
      return formatRatio(atsOdds(bet.ats!));
    case 'BIG':
      return '1:1';
    case 'PROP': {
      const p = bet.prop!;
      if (p in PROP_ODDS) return formatRatio(PROP_ODDS[p as keyof typeof PROP_ODDS]);
      return 'split';
    }
    default:
      return '1:1';
  }
}
