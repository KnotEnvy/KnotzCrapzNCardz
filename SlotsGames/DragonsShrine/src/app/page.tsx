'use client';

/**
 * The cabinet, assembled.
 *
 * Every piece below is self-contained and selects what it needs from the
 * store, so this file has no game logic in it at all -- it is a layout and a
 * stacking order, and that is deliberate. If something here starts needing to
 * know what phase the machine is in, it belongs in the piece, not here.
 *
 * The stack, back to front:
 *
 *   Backdrop        the shrine, parallaxed, reacting to the mood
 *   the cabinet     top glass, jackpots, reels, meters, controls
 *   FeatureOverlay  free spins, the link, the gamble, the big win takeovers
 *   FxLayer         particles over everything, never interactive
 *   Dialogs         paytable, settings, session
 *
 * The layout is a column that fits the viewport exactly and never scrolls:
 * the reels take whatever height is left after the fixed chrome, which is what
 * keeps the spin button reachable on a phone in portrait without a media query
 * per breakpoint.
 *
 * On a short, wide screen -- a landscape phone -- that column does not work at
 * any size, because the chrome's own height is larger than the viewport and
 * the reels are the band that yields. There the layout turns: the board keeps
 * the left, and the meters and the deck stand in a rail down the right. See
 * the `tight` variant in globals.css for why compressing the chrome instead
 * was measured and rejected.
 */

import { useEffect } from 'react';
import { Backdrop } from '@/components/fx/Backdrop';
import { FxLayer } from '@/components/fx/FxLayer';
import { ControlDeck } from '@/components/cabinet/ControlDeck';
import { Dialogs } from '@/components/cabinet/Dialogs';
import { JackpotLadder } from '@/components/cabinet/JackpotLadder';
import { Meters } from '@/components/cabinet/Meters';
import { TopGlass } from '@/components/cabinet/TopGlass';
import { FeatureOverlay } from '@/components/features/FeatureOverlay';
import { StartScreen } from '@/components/cabinet/StartScreen';
import { ReelWindow } from '@/components/reels/ReelWindow';
import { unlockAudio } from '@/lib/audio';

export default function Page() {
  /*
   * Browsers will not start an AudioContext until the page has been touched,
   * and they are right to. The first gesture of any kind unlocks it and the
   * listener removes itself -- `once` on all three so that a player who spins
   * with the keyboard is not silent because they never tapped anything.
   */
  useEffect(() => {
    const unlock = () => unlockAudio();
    const opts = { once: true, passive: true } as const;
    window.addEventListener('pointerdown', unlock, opts);
    window.addEventListener('keydown', unlock, opts);
    window.addEventListener('touchstart', unlock, opts);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  return (
    <main className="relative flex h-full w-full flex-col overflow-hidden">
      <Backdrop />

      <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center gap-1 px-2 py-1 sm:gap-2 sm:px-4 sm:py-2">
        {/* The marquee stays across the top in both layouts: it carries the
            free-spins counter and the banner, and both want the full width. */}
        <TopGlass />

        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center gap-1 sm:gap-2 tight:flex-row tight:items-stretch">
          {/* The board. Jackpots ride directly above it, which is where the
              top box lives on a real cabinet, and they travel together when
              the layout turns. */}
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center gap-1 sm:gap-2">
            <JackpotLadder />
            {/* min-h-0 is what lets the reel window shrink inside a flex column
                instead of forcing the controls off the bottom of a short
                screen. */}
            <ReelWindow className="min-h-0 w-full flex-1" />
          </div>

          {/* Meters and deck: beneath the board when there is height for them,
              beside it when there is not. */}
          <div className="flex w-full min-w-0 shrink-0 flex-col items-center gap-1 sm:gap-2 tight:w-[34%] tight:max-w-[330px] tight:min-w-[236px] tight:justify-end">
            <Meters />
            <ControlDeck />
          </div>
        </div>
      </div>

      <FeatureOverlay />
      <FxLayer />
      <Dialogs />
      {/* Last in the tree so it wins the tie against the particle canvas, but
          at z-40 so the dialogs still open over it -- reading the paytable
          before putting anything at stake is the point of having it here. */}
      <StartScreen />
    </main>
  );
}
