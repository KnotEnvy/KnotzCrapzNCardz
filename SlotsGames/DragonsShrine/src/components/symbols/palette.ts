/**
 * The paint box the twelve symbols are mixed from.
 *
 * Every colour here is a reference to a design token declared in
 * `globals.css`, never a literal. That is not tidiness for its own sake: the
 * shrine's palette is retuned as a whole -- warm the gold, cool the ink -- and
 * a hex typed into a dragon's horn is a colour that silently stops following
 * the rest of the cabinet.
 *
 * The two exceptions are pure white and pure black, which are not palette
 * colours at all. They are *light* and *shadow*, always used through an alpha
 * or a `color-mix`, and they are the same in every theme a cabinet could have.
 *
 * Shades are derived with `color-mix` rather than declared, for the same
 * reason `Chip.tsx` derives a chip's side wall from its face: a bevel that is
 * computed from the surface it sits on can never drift out of sync with it.
 */

import type { SymbolId } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

/** Light and shadow. Never used opaque -- always mixed or given an alpha. */
export const LIGHT = '#ffffff';
export const SHADOW = '#000000';

/**
 * The palette, as CSS variable references.
 *
 * These go into `style={{ fill: ... }}` rather than a `fill=` attribute:
 * `var()` is a CSS value, and SVG presentation attributes are not parsed as
 * CSS. Getting that wrong fails silently to black, which is why every fill in
 * the symbol art goes through a style object.
 */
export const P = {
  ink950: 'var(--color-ink-950)',
  ink900: 'var(--color-ink-900)',
  ink850: 'var(--color-ink-850)',
  ink800: 'var(--color-ink-800)',
  ink700: 'var(--color-ink-700)',
  ink600: 'var(--color-ink-600)',
  ink500: 'var(--color-ink-500)',
  ink400: 'var(--color-ink-400)',
  ink300: 'var(--color-ink-300)',
  ink200: 'var(--color-ink-200)',
  ink100: 'var(--color-ink-100)',

  cinnabar900: 'var(--color-cinnabar-900)',
  cinnabar800: 'var(--color-cinnabar-800)',
  cinnabar700: 'var(--color-cinnabar-700)',
  cinnabar600: 'var(--color-cinnabar-600)',
  cinnabar500: 'var(--color-cinnabar-500)',
  cinnabar400: 'var(--color-cinnabar-400)',
  cinnabar300: 'var(--color-cinnabar-300)',

  jade900: 'var(--color-jade-900)',
  jade800: 'var(--color-jade-800)',
  jade700: 'var(--color-jade-700)',
  jade600: 'var(--color-jade-600)',
  jade500: 'var(--color-jade-500)',
  jade400: 'var(--color-jade-400)',
  jade300: 'var(--color-jade-300)',

  gold900: 'var(--color-gold-900)',
  gold800: 'var(--color-gold-800)',
  gold700: 'var(--color-gold-700)',
  gold600: 'var(--color-gold-600)',
  gold500: 'var(--color-gold-500)',
  gold400: 'var(--color-gold-400)',
  gold300: 'var(--color-gold-300)',
  gold200: 'var(--color-gold-200)',

  ember700: 'var(--color-ember-700)',
  ember600: 'var(--color-ember-600)',
  ember500: 'var(--color-ember-500)',
  ember400: 'var(--color-ember-400)',
  ember300: 'var(--color-ember-300)',
  ember200: 'var(--color-ember-200)',

  violet900: 'var(--color-violet-900)',
  violet800: 'var(--color-violet-800)',
  violet700: 'var(--color-violet-700)',
  violet600: 'var(--color-violet-600)',
  violet500: 'var(--color-violet-500)',
  violet400: 'var(--color-violet-400)',
} as const;

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

/** `c` pushed `amount` of the way toward black. */
export function darken(c: string, amount: number): string {
  return `color-mix(in srgb, ${c} ${Math.round((1 - amount) * 100)}%, ${SHADOW})`;
}

/** `c` pushed `amount` of the way toward white. */
export function lighten(c: string, amount: number): string {
  return `color-mix(in srgb, ${c} ${Math.round((1 - amount) * 100)}%, ${LIGHT})`;
}

/** `a` and `b` blended, `t` being how much of `b`. */
export function blend(a: string, b: string, t: number): string {
  return `color-mix(in srgb, ${a} ${Math.round((1 - t) * 100)}%, ${b})`;
}

/** Light at `alpha`, for rim highlights and specular hits. */
export function glint(alpha: number): string {
  return `rgb(255 255 255 / ${alpha})`;
}

/** Shadow at `alpha`, for contact shadows and inner darkness. */
export function murk(alpha: number): string {
  return `rgb(0 0 0 / ${alpha})`;
}

/* ------------------------------------------------------------------ *
 * The twelve
 * ------------------------------------------------------------------ */

export type SymbolTier = 'low' | 'mid' | 'high' | 'special';

export interface SymbolMeta {
  /** What a screen reader and the paytable call it. */
  label: string;
  tier: SymbolTier;
  /**
   * The one colour that stands for this symbol everywhere outside its own
   * art -- the win frame's tint, a particle burst, a paytable row's rule.
   */
  color: string;
}

/**
 * Tier is the whole visual hierarchy in one word.
 *
 * A player has to know, without reading a paytable, that a dragon is worth
 * more than a fan. That ranking is carried by the tile before the emblem is
 * even resolved: lows sit on cold slate with a thin bronze edge, mids warm up
 * and gain a proper gilt line, highs get black lacquer, a heavy gold frame and
 * corner rosettes, and the three specials break the pattern entirely by
 * lighting from within. It is the same trick a cabinet's glass uses, and it
 * works at 96px because it is carried by value and edge weight, not detail.
 */
export const SYMBOL_META: Record<SymbolId, SymbolMeta> = {
  COIN: { label: 'Coin', tier: 'low', color: P.gold500 },
  LOTUS: { label: 'Lotus', tier: 'low', color: P.cinnabar300 },
  FAN: { label: 'Fan', tier: 'low', color: P.cinnabar500 },
  LANTERN: { label: 'Lantern', tier: 'low', color: P.ember400 },
  KOI: { label: 'Koi', tier: 'mid', color: P.cinnabar400 },
  TURTLE: { label: 'Turtle', tier: 'mid', color: P.jade400 },
  TIGER: { label: 'Tiger', tier: 'mid', color: P.ember400 },
  PHOENIX: { label: 'Phoenix', tier: 'high', color: P.ember300 },
  DRAGON: { label: 'Dragon', tier: 'high', color: P.gold300 },
  WILD: { label: 'Wild shrine gate', tier: 'special', color: P.cinnabar500 },
  SCATTER: { label: 'Golden pearl', tier: 'special', color: P.gold300 },
  ORB: { label: 'Fire orb', tier: 'special', color: P.ember400 },
};

/** Every symbol id, in paytable order. Handy for the ghost atlas and previews. */
export const ALL_SYMBOLS: SymbolId[] = [
  'COIN',
  'LOTUS',
  'FAN',
  'LANTERN',
  'KOI',
  'TURTLE',
  'TIGER',
  'PHOENIX',
  'DRAGON',
  'WILD',
  'SCATTER',
  'ORB',
];
