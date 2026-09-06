/**
 * Money.
 *
 * Every amount in the engine is an integer number of cents, and this file is
 * the only place that knows it. Two reasons, both practical:
 *
 *   - A three-to-two blackjack on a five dollar bet pays seven dollars fifty.
 *     A six-to-five on the same bet pays six. Halves are real money at a real
 *     table, so dollars have to be fractional somewhere; cents put the
 *     fraction in the integer instead of in the float.
 *
 *   - The simulation suite deals a hundred thousand rounds and then measures
 *     an edge in the third decimal place. Accumulated binary rounding on a
 *     million float additions is the same order of magnitude as the thing
 *     being measured.
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
  const body = rem === 0 ? whole.toLocaleString('en-US') : (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
 * Floored, never rounded: a $5 bet at 3:2 is $7.50 exactly, but a $5 bet at
 * 7:5 is $7.00 and not $7.0000001, and a $1 bet at 6:5 is $1 rather than
 * $1.20 at a table whose smallest chip is a dollar — though this engine deals
 * in cents, so it pays the twenty.
 */
export function winnings(stake: number, num: number, den: number): number {
  return Math.floor((stake * num) / den);
}
