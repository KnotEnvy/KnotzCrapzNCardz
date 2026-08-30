'use client';

/**
 * What every feature screen sits inside.
 *
 * The rules a takeover has to obey are short and non-negotiable. It covers the
 * cabinet but never the whole document, so the meters stay legible underneath.
 * It is always skippable, by tapping it, by the spin button, and by Escape --
 * the store's `skip()` is the single exit and every screen routes to it. It
 * never traps focus, because a celebration is not a dialog and a player who
 * cannot tab out of a win screen will remember only that.
 *
 * `reducedMotion` is honoured by swapping every entrance for a short
 * cross-fade rather than by removing the screen. A player who asked for less
 * motion still wants to be told they won four thousand dollars.
 */

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { cn } from '@/components/ui/primitives';

export function OverlayShell({
  label,
  onSkip,
  reduced,
  children,
  className,
  scrimClassName,
  /** Interactive screens announce themselves once; celebrations keep talking. */
  live = 'polite',
}: {
  label: string;
  onSkip?: () => void;
  reduced: boolean;
  children: React.ReactNode;
  className?: string;
  scrimClassName?: string;
  live?: 'polite' | 'off';
}) {
  return (
    <motion.section
      key={label}
      role="region"
      aria-label={label}
      aria-live={live}
      initial={reduced ? { opacity: 0 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.22 }}
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5"
    >
      <div
        className={cn(
          'absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,rgba(10,12,18,0.86),rgba(5,6,10,0.97))] backdrop-blur-[2px]',
          scrimClassName,
        )}
        onClick={onSkip}
        aria-hidden
      />
      <div className={cn('relative flex w-full max-w-3xl flex-col items-center', className)}>
        {children}
      </div>
    </motion.section>
  );
}

/** The line that tells a player they are not stuck here. */
export function SkipHint({ onSkip, text = 'Tap to continue' }: { onSkip: () => void; text?: string }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="mt-4 rounded px-3 py-1 text-[10px] font-semibold tracking-[0.24em] text-ink-400 uppercase transition-colors hover:text-gold-300"
    >
      {text}
    </button>
  );
}

/**
 * A count of embers drifting up behind a celebration.
 *
 * Pure decoration, and the first thing to go under reduced motion. Positions
 * are derived from the index rather than random so the field is stable across
 * re-renders instead of reshuffling on every store tick.
 */
export function Embers({ n = 18, color = 'var(--color-ember-400)' }: { n?: number; color?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="fx-decorative absolute bottom-0 h-1.5 w-1.5 rounded-full"
          style={{
            left: `${((i * 37) % 100)}%`,
            background: color,
            filter: 'blur(1px)',
            animation: `ds-emberfloat ${2.6 + ((i * 7) % 22) / 10}s ease-out ${((i * 13) % 30) / 10}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/** Wraps a value so it re-animates whenever the value itself changes. */
export function Pop({
  trigger,
  reduced,
  children,
  className,
}: {
  trigger: string | number;
  reduced: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={trigger}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
        transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 500, damping: 26 }}
        className={cn('inline-block', className)}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
