/**
 * Money.
 *
 * Every amount in the engine is an integer number of cents, and this file is
 * the only place that knows it. Three Card Poker's own paytables happen to be
 * whole-number ratios — forty to one, five to one, even money — so a dollar
 * wager never pays a fraction today. Cents are here anyway, for two reasons:
 *
 *   - Paytables with half-unit lines exist (an Ante Bonus paying 12½ to 1 on a
 *     straight flush is one), and a wager of an odd number of dollars against
 *     one of those pays a half. The engine should not need rewriting the day a
 *     table like that is added.
 *
 *   - The measurement suite deals millions of rounds and then compares an edge
 *     in the third decimal place with an exact enumeration. Accumulated binary
 *     rounding over millions of float additions is the same order of magnitude
 *     as the thing being measured.
 *
 * Rounding never favours the player: a payout that lands between cents is
 * floored, exactly as a dealer short-pays to the nearest chip.
 */

/** Dollars in, cents out. For chip denominations and rule defaults. */
export function dollars(n: number): number {
  return Math.round(n * 100);
}

/** `$12.50`, or `$12` when the cents are zero. Negative values carry a minus. */
export function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  const body =
    rem === 0
      ? whole.toLocaleString('en-US')
      : (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${body}`;
}

/** `+$12.50` / `-$8` / `even`. What a settlement chip says. */
export function fmtSigned(cents: number): string {
  if (cents === 0) return 'even';
  return cents > 0 ? `+${fmt(cents)}` : fmt(cents);
}

/**
 * What a wager of `stake` returns at `num:den`, as winnings only.
 *
 * Floored, never rounded: a $5 bet at 40:1 is $200 exactly, and a $5 bet at a
 * hypothetical 25:2 is $62.50 exactly, but a 1¢ bet at 25:2 is 12¢ and not
 * 12.5¢.
 */
export function winnings(stake: number, num: number, den: number): number {
  return Math.floor((stake * num) / den);
}
