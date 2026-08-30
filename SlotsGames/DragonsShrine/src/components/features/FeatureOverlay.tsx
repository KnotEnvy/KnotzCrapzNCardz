'use client';

/**
 * The switchboard.
 *
 * Every feature screen in this folder is a pure function of its props -- the
 * takeover does not know what a store is, the link board is handed twenty
 * cells and a number. This file is the one place that knows both, and all it
 * does is read the phase and hand the right screen the right facts.
 *
 * Keeping the mapping in one component rather than spreading it across five is
 * what makes the invariant checkable by reading: exactly one screen is up at a
 * time, `skip()` is the only way out of any of them, and when the phase calls
 * for nothing this renders nothing at all. That last part is not cosmetic --
 * an overlay that stays mounted with zero opacity eats every tap meant for the
 * spin button, which is the classic way a cabinet ends up "frozen".
 */

import { AnimatePresence } from 'motion/react';
import * as React from 'react';
import { FeatureCards } from './FeatureCards';
import { Gamble } from './Gamble';
import { HoldAndWin } from './HoldAndWin';
import { Takeover } from './Takeover';
import { FxStyles } from '@/components/ui/primitives';
import { useSlots } from '@/lib/store/useSlots';

export function FeatureOverlay(): React.JSX.Element {
  const phase = useSlots((s) => s.phase);
  const presentation = useSlots((s) => s.presentation);
  const featureCard = useSlots((s) => s.featureCard);
  const meter = useSlots((s) => s.meter);
  const totalBet = useSlots((s) => s.totalBet);
  const free = useSlots((s) => s.free);
  const hold = useSlots((s) => s.hold);
  const orbs = useSlots((s) => s.orbs);
  const gamble = useSlots((s) => s.gamble);
  const reduced = useSlots((s) => s.prefs.reducedMotion);

  const skip = useSlots((s) => s.skip);
  const chooseGamble = useSlots((s) => s.chooseGamble);
  const collectGamble = useSlots((s) => s.collectGamble);

  /*
   * The link board prefers `orbs`, which is the live grid the sequencer lands
   * them onto; `hold.orbs` is the same list settled into the feature's own
   * record and stands in only if the two have not met yet.
   */
  const board = orbs.length > 0 ? orbs : (hold?.orbs ?? []);

  let screen: React.ReactNode = null;

  if (phase === 'TAKEOVER' && presentation) {
    screen = (
      <Takeover
        key="takeover"
        tier={presentation.tier}
        amount={presentation.amount}
        shown={meter}
        totalBet={totalBet}
        cumulative={presentation.cumulative}
        reduced={reduced}
        onSkip={skip}
      />
    );
  } else if (phase === 'FEATURE_INTRO' || phase === 'FEATURE_OUTRO') {
    screen = (
      <FeatureCards
        key={`card-${featureCard?.key ?? phase}`}
        card={featureCard}
        free={free}
        hold={hold}
        totalBet={totalBet}
        reduced={reduced}
        onSkip={skip}
      />
    );
  } else if (phase === 'HOLD') {
    screen = (
      <HoldAndWin
        key="hold"
        orbs={board}
        respinsLeft={hold?.respinsLeft ?? 0}
        collected={hold?.collected ?? 0}
        awardedJackpots={hold?.awardedJackpots ?? []}
        totalBet={hold?.totalBet ?? totalBet}
        reduced={reduced}
        onSkip={skip}
      />
    );
  } else if (phase === 'GAMBLE' && gamble) {
    screen = (
      <Gamble
        key="gamble"
        stake={gamble.stake}
        step={gamble.step}
        history={gamble.history}
        reduced={reduced}
        onChoose={chooseGamble}
        onCollect={collectGamble}
      />
    );
  }

  /* `AnimatePresence` renders no element of its own, so an idle cabinet has
     nothing at all sitting over it. */
  return (
    <>
      <FxStyles />
      <AnimatePresence mode="wait">{screen}</AnimatePresence>
    </>
  );
}
