/**
 * The one enumeration too slow for the everyday suite.
 *
 * All 20,358,520 six-card sets, each classified by the same `bestFive` the
 * settlement uses, counted, and held against `SIX_CARD_COUNTS`. About ten
 * seconds. Every 6 Card Bonus figure the game prints is a weighted sum of these
 * counts, so this is the test that stands behind all of them.
 *
 *     pnpm run test:stats
 */

import { describe, expect, it } from 'vitest';
import { SIX_CARD_COUNTS, SIX_CARD_SETS, deriveSixCardCounts } from './analysis';

describe('six-card sets', () => {
  it('counts every one by its best five-card hand', () => {
    const derived = deriveSixCardCounts();
    expect(derived).toEqual(SIX_CARD_COUNTS);
    expect(Object.values(derived).reduce((n, x) => n + x, 0)).toBe(SIX_CARD_SETS);
  }, 120_000);
});
