/**
 * Money, on the floor's side of the wire.
 *
 * Every amount the shell handles is an integer number of cents, straight from
 * the API, and nothing here ever turns one into a float to do arithmetic with.
 * The only division is the one that puts a decimal point in a string.
 */

/** `$12.50`, or `$12` when the cents are zero. */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const rem = abs % 100;
  const body =
    rem === 0
      ? Math.floor(abs / 100).toLocaleString('en-US')
      : (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${body}`;
}

/**
 * `$1.2M`, `$48.5K`, `$920` — for a figure that has to fit a tile.
 *
 * Rounds down rather than to nearest, because a wallet that reads `$1.0M` when
 * it holds $999,999 is a wallet that has lied about the only thing a player
 * checks it for.
 */
export function moneyShort(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const dollars = Math.floor(Math.abs(cents) / 100);
  if (dollars >= 1_000_000) return `${sign}$${trim(Math.floor(dollars / 100_000) / 10)}M`;
  if (dollars >= 10_000) return `${sign}$${trim(Math.floor(dollars / 100) / 10)}K`;
  return `${sign}$${dollars.toLocaleString('en-US')}`;
}

function trim(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

/** `+$12.50` / `-$8` / `even`. What a settlement row says. */
export function moneySigned(cents: number): string {
  if (cents === 0) return 'even';
  return cents > 0 ? `+${money(cents)}` : money(cents);
}

/** Whole dollars, as a number, for an input field. */
export function toDollars(cents: number): number {
  return Math.round(cents / 100);
}

export function fromDollars(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * `4 minutes`, `2 hours`, `just now` — for the ticker and the ledger.
 *
 * Deliberately coarse. A ticker that says "43 seconds ago" is a ticker that
 * has to re-render every second to stay true, and nobody reads it that closely.
 */
export function ago(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
