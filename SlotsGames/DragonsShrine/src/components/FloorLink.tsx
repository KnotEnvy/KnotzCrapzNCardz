'use client';

/**
 * This game's connection to the casino floor, as a component that draws
 * nothing.
 *
 * A component because the link has to be established after hydration and torn
 * down with the page, and an effect in the tree is the honest way to say so. It
 * is mounted in the root layout rather than in the page, because the page may
 * not be showing the table yet — a start screen is still a page that needs a
 * wallet behind it — and the link is what makes the start screen unnecessary on
 * the floor.
 *
 * Outside the casino it does nothing at all: `linkToFloor` returns a no-op when
 * the page is not framed by a floor.
 */

import * as React from 'react';
import { linkToFloor } from '@/lib/casino/link';

export function FloorLink(): null {
  React.useEffect(() => linkToFloor(), []);
  return null;
}
