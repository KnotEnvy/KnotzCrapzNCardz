'use client';

/**
 * The symbol, as the rest of the game consumes it.
 *
 * Everything above this file -- the reel window, the paytable, the
 * hold-and-win board, the takeover -- knows exactly two things about a symbol:
 * its id and what it is currently doing. `SymbolArt` turns that pair into
 * pixels, and it is the only place in the codebase allowed to know how.
 *
 * The five states are a deliberately small vocabulary, because a state that
 * exists gets used and a state that is nearly the same as another one gets
 * used wrongly:
 *
 *   `idle`   at rest on the board, breathing.
 *   `win`    part of the line currently being paid: pulse, gold burst, glow.
 *   `dim`    on the board but not on the lit line: desaturated and pushed back.
 *   `land`   the instant it arrived, played once by the reel that dropped it.
 *   `ghost`  in motion on a spinning band -- silhouette only, no animation.
 *
 * Sizing is driven by `--cell-size` and the `scale` prop rather than by
 * width/height props, so the same component fills a 96px reel cell and a 288px
 * paytable card without a single conditional. A caller that wants a size the
 * scale ladder does not offer sets `--cell-size` on a wrapper element; that is
 * the documented escape hatch and it is what the hold-and-win board uses.
 */

import * as React from 'react';
import type { SymbolId } from '@/lib/engine/types';
import { SymbolBody } from './art';
import { SYMBOL_META } from './palette';
import './symbols.css';

export type { SymbolTier, SymbolMeta } from './palette';
export { SYMBOL_META, ALL_SYMBOLS, P as SYMBOL_PALETTE } from './palette';

export type SymbolState = 'idle' | 'win' | 'dim' | 'land' | 'ghost';

export interface SymbolArtProps {
  id: SymbolId;
  state?: SymbolState;
  /** Multiplier on the base cell size; 1 is a reel cell. */
  scale?: number;
  /**
   * Fill the parent box instead of taking a cell-sized one.
   *
   * For callers that have already sized their container -- a paytable card, an
   * orb sitting in a niche -- and want the art to match it. Reaching for
   * `className="h-full w-full"` instead does not work and fails in the least
   * obvious way possible: the utility and `.ds-sym` have the same specificity,
   * so which one wins depends on the order the stylesheets happened to be
   * concatenated in, and when `.ds-sym` wins the art keeps its 96px box inside
   * a smaller `overflow-hidden` parent and is silently cropped to its own
   * top-left corner. This prop is an attribute selector and therefore always
   * wins.
   */
  fit?: boolean;
  className?: string;
}

/**
 * One symbol.
 *
 * Memoised on purpose. Twenty of these sit on the board and the store touches
 * the grid on every reel that lands, so without this the whole board rebuilds
 * five times a spin to change four cells.
 */
export const SymbolArt = React.memo(function SymbolArt({
  id,
  state = 'idle',
  scale = 1,
  fit = false,
  className,
}: SymbolArtProps): React.JSX.Element {
  const meta = SYMBOL_META[id];
  return (
    <svg
      viewBox="0 0 100 100"
      className={className ? `ds-sym ${className}` : 'ds-sym'}
      data-sym={id}
      data-state={state}
      data-tier={meta.tier}
      data-fit={fit ? 'true' : undefined}
      style={{ '--sym-scale': scale } as React.CSSProperties}
      role="img"
      aria-label={meta.label}
      focusable="false"
    >
      <SymbolBody id={id} ghost={state === 'ghost'} />
    </svg>
  );
});
