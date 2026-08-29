/**
 * Turning cents into something a player reads without thinking.
 *
 * The whole game holds money as integer cents, which is right for the maths
 * and wrong for every label on the cabinet, so the conversion happens here and
 * only here. Two rules run through it.
 *
 * Meters are tabular and never change width mid-count: `$1,240.00` and `$9.00`
 * must occupy predictable space or a count-up jitters sideways as it runs.
 * Pair every one of these with the `.numeric` class.
 *
 * Big numbers get shortened, but only above the point where the exact figure
 * has stopped mattering. A win of $1,847.25 is read as a number; a jackpot of
 * $120,000 is read as a size.
 */

/** `$1,240.00`. The full figure, always two decimals. */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}$${whole.toLocaleString('en-US')}.${frac.toString().padStart(2, '0')}`;
}

/** `$1,240` -- no decimals, for figures where the cents are noise. */
export function moneyRound(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
}

/**
 * `$12.4K`, `$1.2M` -- for jackpot glass and anywhere the figure is a size
 * rather than a sum. Below $10,000 it falls through to {@link moneyRound},
 * because "$4.8K" reads as a rounding of something and "$4,820" reads as money.
 */
export function moneyShort(cents: number): string {
  const abs = Math.abs(cents);
  if (abs < 1_000_000) return moneyRound(cents);
  const sign = cents < 0 ? '-' : '';
  const dollars = Math.abs(cents) / 100;
  if (dollars < 1_000_000) return `${sign}$${(dollars / 1000).toFixed(dollars < 100_000 ? 1 : 0)}K`;
  return `${sign}$${(dollars / 1_000_000).toFixed(dollars < 10_000_000 ? 2 : 1)}M`;
}

/** `12.40x` -- a win as a multiple of the stake. */
export function ratio(amount: number, totalBet: number): string {
  if (totalBet <= 0) return '0x';
  const r = amount / totalBet;
  return `${r >= 100 ? Math.round(r) : r.toFixed(r >= 10 ? 1 : 2)}x`;
}

/** `2,340` -- a plain count with separators. */
export function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * The paytable's own way of quoting a line pay.
 *
 * Pays are stored as multiples of the line bet, and the glass shows both: the
 * multiple, because that is what the paytable means, and the cash at the
 * current stake, because that is what the player wants to know.
 */
export function linePay(multiplier: number, betPerLine: number): string {
  return `${count(multiplier)}  ${money(multiplier * betPerLine)}`;
}

/** `1:24` -- elapsed seconds as a session clock. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

/** `+$4.50` / `-$1.00`, for anything showing a change rather than a total. */
export function delta(cents: number): string {
  return `${cents >= 0 ? '+' : ''}${money(cents)}`;
}
