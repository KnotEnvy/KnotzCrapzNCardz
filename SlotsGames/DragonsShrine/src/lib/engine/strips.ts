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
 *
 * Every band is exactly {@link BAND_LENGTH} stops long. That is not a
 * requirement of anything -- it is a tuning convenience. When every reel is
 * the same length, a count is a probability in per-cent and the whole table
 * can be read as one, which matters when the difference between a 95.5% and a
 * 96.8% machine is two symbols moved between two reels.
 */

import type { StripSet, SymbolId } from './types';
import { REELS } from './types';

/** How many of each symbol appear on one reel's band. Absent means none. */
export type StripCounts = Partial<Record<SymbolId, number>>;

/**
 * Stack heights, for symbols that are printed in blocks rather than singly.
 *
 * The count in {@link StripCounts} is always the number of *symbols* on the
 * band; a height of 3 means those symbols are grouped into blocks of three, so
 * a count of 6 is two blocks. The count must divide by the height.
 */
export type StackHeights = Partial<Record<SymbolId, number>>;

/**
 * Expand counts into a band, spreading each symbol as evenly as it will go.
 *
 * The method is largest-remainder placement: symbols are laid down rarest
 * first, each one taking the free slot closest to its ideal even spacing. That
 * yields a band with no adjacent duplicates wherever the counts permit one,
 * and a stable, reproducible order -- the same counts always print the same
 * band, which matters because the RTP simulation is seeded against it.
 *
 * `stacks` is the one deliberate exception to the no-adjacent-duplicates rule,
 * and the whole hold-and-win feature depends on it. A four-row window over an
 * evenly spread band can show at most one copy of a symbol spaced more than
 * four apart, so five reels of evenly spread orbs can never show more than
 * five orbs -- and the link needs six. Real link machines solve this the same
 * way: the link symbol is printed in blocks of two or three, so one reel can
 * drop three orbs at once and six becomes a rare but reachable event rather
 * than an impossible one. Layout runs over *blocks*, so two blocks are still
 * never adjacent; only the symbols inside a block touch.
 */
export function buildStrip(counts: StripCounts, stacks: StackHeights = {}): SymbolId[] {
  const entries = Object.entries(counts).filter(([, n]) => (n ?? 0) > 0) as [SymbolId, number][];
  if (entries.length === 0) throw new Error('buildStrip: empty strip');

  // Blocks, not symbols, are what gets placed. For an unstacked symbol the two
  // are the same thing and the arithmetic below collapses to the old one.
  const blocks: [SymbolId, number, number][] = entries.map(([symbol, n]) => {
    const height = stacks[symbol] ?? 1;
    if (n % height !== 0) {
      throw new Error(`buildStrip: ${symbol} count ${n} is not a whole number of ${height}-stacks`);
    }
    return [symbol, n / height, height];
  });

  const slots = blocks.reduce((s, [, n]) => s + n, 0);
  const band: (SymbolId | null)[] = new Array(slots).fill(null);
  // Rarest first: the scarce symbols get their pick of positions, so a single
  // scatter on a 70-stop band lands mid-strip rather than wherever is left.
  blocks.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  for (const [symbol, n] of blocks) {
    const spacing = slots / n;
    for (let i = 0; i < n; i++) {
      const ideal = Math.round(i * spacing + spacing / 2) % slots;
      let slot = -1;
      // Walk outwards from the ideal slot for the first free one that does not
      // sit next to a copy of the same symbol; fall back to any free slot.
      for (let d = 0; d < slots && slot < 0; d++) {
        for (const cand of d === 0 ? [ideal] : [(ideal + d) % slots, (ideal - d + slots) % slots]) {
          if (band[cand] !== null) continue;
          const prev = band[(cand - 1 + slots) % slots];
          const next = band[(cand + 1) % slots];
          if (prev === symbol || next === symbol) continue;
          slot = cand;
          break;
        }
      }
      if (slot < 0) slot = band.indexOf(null);
      band[slot] = symbol;
    }
  }

  const out: SymbolId[] = [];
  const heightOf = new Map(blocks.map(([symbol, , height]) => [symbol, height]));
  for (const symbol of band as SymbolId[]) {
    const height = heightOf.get(symbol) ?? 1;
    for (let i = 0; i < height; i++) out.push(symbol);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The bands
 * ------------------------------------------------------------------ */

/**
 * Stops on every band.
 *
 * A hundred is chosen so that a count reads directly as the chance of that
 * symbol landing on any one cell: DRAGON 6 on reel 1 is a six-per-cent dragon.
 * Every figure in `rtp.sim.test.ts` was tuned by moving these by ones and
 * twos, and being able to do that arithmetic in your head is worth more than
 * the handful of stops a shorter band would save.
 */
export const BAND_LENGTH = 100;

/**
 * The orb blocks.
 *
 * Reels 2, 3 and 4 print orbs in threes and the outer reels in twos, so the
 * biggest board the strips can produce is 2+3+3+3+2 = thirteen orbs and the
 * six needed for the link wants three reels to drop a full block. That shape
 * is why the link triggers around once in seven hundred spins while an orb
 * itself is on screen most of the time: seeing orbs is common, seeing them
 * *arrive together* is the event.
 */
const ORB_STACKS: StackHeights[] = [{ ORB: 2 }, { ORB: 3 }, { ORB: 3 }, { ORB: 3 }, { ORB: 2 }];

/**
 * Base game.
 *
 * Reel 1 carries no wild: a wild on the leftmost reel turns every three-of-a-
 * kind into a four, which is a large and invisible chunk of return. Reels 2, 3
 * and 4 carry them and reel 5 carries fewer, which is the usual shape and the
 * reason a five-of-a-kind stays an event.
 *
 * The low four are deliberately fat. At fifty lines a machine that only pays
 * when something good happens feels broken long before it feels stingy, and
 * roughly a quarter of all spins returning *something* is what buys the
 * patience the features need.
 */
const BASE_COUNTS: StripCounts[] = [
  { COIN: 15, LOTUS: 14, FAN: 13, LANTERN: 12, KOI: 10, TURTLE: 9, TIGER: 8, PHOENIX: 7, DRAGON: 6, SCATTER: 2, ORB: 4 },
  { COIN: 14, LOTUS: 13, FAN: 12, LANTERN: 11, KOI: 10, TURTLE: 9, TIGER: 8, PHOENIX: 6, DRAGON: 5, WILD: 4, SCATTER: 2, ORB: 6 },
  { COIN: 14, LOTUS: 13, FAN: 12, LANTERN: 11, KOI: 9, TURTLE: 9, TIGER: 8, PHOENIX: 6, DRAGON: 5, WILD: 5, SCATTER: 2, ORB: 6 },
  { COIN: 14, LOTUS: 13, FAN: 12, LANTERN: 11, KOI: 10, TURTLE: 9, TIGER: 8, PHOENIX: 6, DRAGON: 5, WILD: 4, SCATTER: 2, ORB: 6 },
  { COIN: 15, LOTUS: 14, FAN: 13, LANTERN: 12, KOI: 10, TURTLE: 9, TIGER: 8, PHOENIX: 5, DRAGON: 5, WILD: 3, SCATTER: 2, ORB: 4 },
];

/**
 * Free spins.
 *
 * No orbs -- the link cannot trigger from inside the shrine -- and the low
 * symbols thin out in favour of the animals, so the multiplier trail has
 * something worth multiplying. Wilds roughly double, which is the single
 * biggest reason a free spin is worth several times a base spin before the
 * trail touches it.
 *
 * Reel 1 still carries no wild. That is what keeps the WILD row of the
 * paytable an event rather than the thing the feature actually pays: with the
 * dragon able to take reels 2, 3 and 4 whole, a wild on reel 1 would turn a
 * three-dragon-reel spin into fifty lines of five wilds at once.
 */
const FREE_COUNTS: StripCounts[] = [
  { COIN: 13, LOTUS: 13, FAN: 12, LANTERN: 11, KOI: 11, TURTLE: 10, TIGER: 10, PHOENIX: 9, DRAGON: 8, SCATTER: 3 },
  { COIN: 12, LOTUS: 12, FAN: 11, LANTERN: 11, KOI: 10, TURTLE: 10, TIGER: 9, PHOENIX: 8, DRAGON: 6, WILD: 8, SCATTER: 3 },
  { COIN: 12, LOTUS: 12, FAN: 11, LANTERN: 11, KOI: 10, TURTLE: 9, TIGER: 9, PHOENIX: 8, DRAGON: 6, WILD: 9, SCATTER: 3 },
  { COIN: 12, LOTUS: 12, FAN: 11, LANTERN: 11, KOI: 10, TURTLE: 10, TIGER: 9, PHOENIX: 8, DRAGON: 6, WILD: 8, SCATTER: 3 },
  { COIN: 13, LOTUS: 12, FAN: 12, LANTERN: 11, KOI: 10, TURTLE: 10, TIGER: 9, PHOENIX: 8, DRAGON: 6, WILD: 6, SCATTER: 3 },
];

/**
 * Hold and win.
 *
 * The respins do not read symbols off a band -- an empty cell either catches an
 * orb or it does not, at `HOLD_LAND_CHANCE` -- but the reels still spin on
 * screen, and this is what they show while they do.
 */
const HOLD_COUNTS: StripCounts[] = new Array<StripCounts>(REELS).fill({
  ORB: 32,
  LANTERN: 26,
  COIN: 24,
  LOTUS: 18,
});

function build(counts: StripCounts[], stacks?: StackHeights[]): SymbolId[][] {
  return counts.map((c, i) => buildStrip(c, stacks?.[i]));
}

/** The three bands, expanded once at module load. */
export const STRIPS: Record<StripSet, SymbolId[][]> = {
  BASE: build(BASE_COUNTS, ORB_STACKS),
  FREE: build(FREE_COUNTS),
  HOLD: build(HOLD_COUNTS),
};

/** The declared counts, kept for the simulation's per-symbol frequency report. */
export const STRIP_COUNTS: Record<StripSet, StripCounts[]> = {
  BASE: BASE_COUNTS,
  FREE: FREE_COUNTS,
  HOLD: HOLD_COUNTS,
};

/** Which symbols are printed in blocks, per band and reel. */
export const STRIP_STACKS: Partial<Record<StripSet, StackHeights[]>> = {
  BASE: ORB_STACKS,
};

/** How long each band is, per reel. The reel renderer needs this to wrap. */
export const STRIP_LENGTHS: Record<StripSet, number[]> = {
  BASE: STRIPS.BASE.map((s) => s.length),
  FREE: STRIPS.FREE.map((s) => s.length),
  HOLD: STRIPS.HOLD.map((s) => s.length),
};
