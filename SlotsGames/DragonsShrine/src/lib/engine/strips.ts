/**
 * The reel strips.
 *
 * A physical slot reel is a printed band; this is that band, as an array of
 * symbols the window slides over. Everything the game feels like comes from
 * these numbers: how often a dragon shows up, whether reel 1 can hold a wild,
 * how close a three-pearl trigger gets to happening on the last reel.
 *
 * Strips are declared as *counts per reel* rather than as a written-out band,
 * for two reasons. Tuning the return means moving one symbol's frequency on
 * one reel, which is a single number here and a needle-in-a-haystack edit in a
 * 60-entry literal. And the expansion is deterministic and anti-clumping --
 * {@link buildStrip} spreads each symbol as evenly as its count allows -- so a
 * strip cannot accidentally be printed with four dragons in a row, which reads
 * as a bug on the glass whatever it does to the maths.
 *
 * Three bands exist. BASE is the machine as it stands. FREE removes the orbs
 * (the link cannot trigger inside free spins) and richens the top end, which
 * is where the feature's extra return comes from. HOLD is only ever used to
 * decide orb landings, and is kept here so every random surface the reels
 * touch lives in one file.
 */

import type { StripSet, SymbolId } from './types';
import { REELS } from './types';

/** How many of each symbol appear on one reel's band. Absent means none. */
export type StripCounts = Partial<Record<SymbolId, number>>;

/**
 * Expand counts into a band, spreading each symbol as evenly as it will go.
 *
 * The method is largest-remainder placement: symbols are laid down rarest
 * first, each one taking the free slot closest to its ideal even spacing. That
 * yields a band with no adjacent duplicates wherever the counts permit one,
 * and a stable, reproducible order -- the same counts always print the same
 * band, which matters because the RTP simulation is seeded against it.
 */
export function buildStrip(counts: StripCounts): SymbolId[] {
  const entries = Object.entries(counts).filter(([, n]) => (n ?? 0) > 0) as [SymbolId, number][];
  const length = entries.reduce((s, [, n]) => s + n, 0);
  if (length === 0) throw new Error('buildStrip: empty strip');

  const band: (SymbolId | null)[] = new Array(length).fill(null);
  // Rarest first: the scarce symbols get their pick of positions, so a single
  // scatter on a 70-stop band lands mid-strip rather than wherever is left.
  entries.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  for (const [symbol, n] of entries) {
    const spacing = length / n;
    for (let i = 0; i < n; i++) {
      const ideal = Math.round(i * spacing + spacing / 2) % length;
      let slot = -1;
      // Walk outwards from the ideal slot for the first free one that does not
      // sit next to a copy of the same symbol; fall back to any free slot.
      for (let d = 0; d < length && slot < 0; d++) {
        for (const cand of d === 0 ? [ideal] : [(ideal + d) % length, (ideal - d + length) % length]) {
          if (band[cand] !== null) continue;
          const prev = band[(cand - 1 + length) % length];
          const next = band[(cand + 1) % length];
          if (prev === symbol || next === symbol) continue;
          slot = cand;
          break;
        }
      }
      if (slot < 0) slot = band.indexOf(null);
      band[slot] = symbol;
    }
  }

  return band as SymbolId[];
}

/* ------------------------------------------------------------------ *
 * The bands
 * ------------------------------------------------------------------ */

/**
 * Base game.
 *
 * Reel 1 carries no wild: a wild on the leftmost reel turns every three-of-a-
 * kind into a four, which is a large and invisible chunk of return. Reels 2, 3
 * and 4 carry them and reel 5 carries fewer, which is the usual shape and the
 * reason a five-of-a-kind stays an event.
 */
const BASE_COUNTS: StripCounts[] = [
  { COIN: 12, LOTUS: 11, FAN: 10, LANTERN: 9, KOI: 7, TURTLE: 6, TIGER: 5, PHOENIX: 4, DRAGON: 3, SCATTER: 2, ORB: 2 },
  { COIN: 11, LOTUS: 10, FAN: 10, LANTERN: 9, KOI: 7, TURTLE: 6, TIGER: 5, PHOENIX: 4, DRAGON: 3, WILD: 3, SCATTER: 2, ORB: 2 },
  { COIN: 11, LOTUS: 10, FAN: 9, LANTERN: 9, KOI: 7, TURTLE: 6, TIGER: 5, PHOENIX: 4, DRAGON: 3, WILD: 4, SCATTER: 2, ORB: 2 },
  { COIN: 11, LOTUS: 10, FAN: 10, LANTERN: 9, KOI: 7, TURTLE: 6, TIGER: 5, PHOENIX: 4, DRAGON: 3, WILD: 3, SCATTER: 2, ORB: 2 },
  { COIN: 12, LOTUS: 11, FAN: 10, LANTERN: 10, KOI: 8, TURTLE: 6, TIGER: 5, PHOENIX: 4, DRAGON: 3, WILD: 2, SCATTER: 2, ORB: 2 },
];

/**
 * Free spins.
 *
 * No orbs -- the link cannot trigger from inside the shrine -- and the low
 * symbols thin out in favour of the animals, so the multiplier trail has
 * something worth multiplying.
 */
const FREE_COUNTS: StripCounts[] = [
  { COIN: 9, LOTUS: 9, FAN: 8, LANTERN: 8, KOI: 7, TURTLE: 6, TIGER: 6, PHOENIX: 5, DRAGON: 4, SCATTER: 2 },
  { COIN: 8, LOTUS: 8, FAN: 8, LANTERN: 8, KOI: 7, TURTLE: 6, TIGER: 6, PHOENIX: 5, DRAGON: 4, WILD: 4, SCATTER: 2 },
  { COIN: 8, LOTUS: 8, FAN: 7, LANTERN: 8, KOI: 7, TURTLE: 6, TIGER: 6, PHOENIX: 5, DRAGON: 4, WILD: 5, SCATTER: 2 },
  { COIN: 8, LOTUS: 8, FAN: 8, LANTERN: 8, KOI: 7, TURTLE: 6, TIGER: 6, PHOENIX: 5, DRAGON: 4, WILD: 4, SCATTER: 2 },
  { COIN: 9, LOTUS: 9, FAN: 8, LANTERN: 8, KOI: 7, TURTLE: 6, TIGER: 6, PHOENIX: 5, DRAGON: 4, WILD: 3, SCATTER: 2 },
];

/**
 * Hold and win.
 *
 * The respins do not read symbols off a band -- an empty cell either catches an
 * orb or it does not, at {@link HOLD_LAND_CHANCE} -- but the reels still spin
 * on screen, and this is what they show while they do.
 */
const HOLD_COUNTS: StripCounts[] = new Array(REELS).fill({ ORB: 6, LANTERN: 5, COIN: 5, LOTUS: 4 });

function build(counts: StripCounts[]): SymbolId[][] {
  return counts.map(buildStrip);
}

/** The three bands, expanded once at module load. */
export const STRIPS: Record<StripSet, SymbolId[][]> = {
  BASE: build(BASE_COUNTS),
  FREE: build(FREE_COUNTS),
  HOLD: build(HOLD_COUNTS),
};

/** The declared counts, kept for the simulation's per-symbol frequency report. */
export const STRIP_COUNTS: Record<StripSet, StripCounts[]> = {
  BASE: BASE_COUNTS,
  FREE: FREE_COUNTS,
  HOLD: HOLD_COUNTS,
};

/** How long each band is, per reel. The reel renderer needs this to wrap. */
export const STRIP_LENGTHS: Record<StripSet, number[]> = {
  BASE: STRIPS.BASE.map((s) => s.length),
  FREE: STRIPS.FREE.map((s) => s.length),
  HOLD: STRIPS.HOLD.map((s) => s.length),
};
