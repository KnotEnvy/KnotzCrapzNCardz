'use client';

/**
 * A game, on the floor.
 *
 * The tile has to do three things at once, and the order they are read in is
 * the layout:
 *
 *   1. Say what the game is, immediately, in its own colour.
 *   2. Say what it costs and what it returns — the limits and the measured
 *      edge. That figure being on the *tile* rather than buried in a rules
 *      dialog is a deliberate house policy: every one of these games has
 *      simulated its own return to three decimal places, and a floor that has
 *      that number and does not show it is being coy about the only thing a
 *      player is owed.
 *   3. Get out of the way of the button.
 *
 * A table the player already has chips on says so and says "back to it", which
 * is the difference between a lobby and a casino: the chips are still there.
 */

import * as React from 'react';
import { GameArt } from '@/components/GameArt';
import { Accent, Button, Panel, Tag } from '@/components/ui/primitives';
import { money, moneyShort } from '@/lib/money';
import type { GameManifest, TableSession } from '@/lib/api';

const KIND_LABEL: Record<GameManifest['kind'], string> = {
  table: 'Table game',
  slots: 'Video slot',
  'video-poker': 'Video poker',
  specialty: 'Specialty',
};

export function GameTile({
  game,
  open,
  onSit,
}: {
  game: GameManifest;
  /** The player's open table at this game, if there is one. */
  open?: TableSession;
  onSit: (game: GameManifest) => void;
}): React.JSX.Element {
  const seated = !!open && open.chips >= 0;

  return (
    <Accent color={game.accent} alt={game.accentAlt} as="article" className="group">
      <Panel live={game.live} className="relative flex h-full flex-col overflow-hidden">
        {/*
         * The wash. A radial in the game's accent behind the art, at low
         * opacity, that comes up on hover — which is what makes a grid of four
         * tiles feel like four rooms rather than four rectangles.
         */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(24rem 14rem at 78% -10%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 65%)',
          }}
        />

        <div className="relative flex items-start gap-4 p-5 pb-3">
          <div
            className="shrink-0 rounded-xl p-2.5 text-[var(--accent)] ring-1 ring-[color-mix(in_oklab,var(--accent)_28%,transparent)]"
            style={{
              background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
              boxShadow: '0 0 2rem -0.8rem color-mix(in oklab, var(--accent) 60%, transparent)',
            }}
          >
            <GameArt game={game} className="h-10 w-10" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="display truncate text-sm text-void-100">{game.title}</h3>
              <Tag tone="accent">{KIND_LABEL[game.kind]}</Tag>
              {!game.live && <Tag tone="plain">soon</Tag>}
            </div>
            <p className="mt-1.5 text-[0.8rem] leading-snug text-void-300">{game.tagline}</p>
          </div>
        </div>

        {/* What it pays. One line, in gold, because it is about money. */}
        <div className="relative mx-5 mb-3 rounded-lg bg-black/25 px-3 py-2 ring-1 ring-white/6">
          <p className="figure text-[0.72rem] leading-tight text-neon-gold/90">{game.edgeLabel}</p>
        </div>

        <ul className="relative mx-5 mb-4 space-y-1.5">
          {game.highlights.slice(0, 4).map((line) => (
            <li key={line} className="flex gap-2 text-[0.74rem] leading-snug text-void-300">
              <span aria-hidden className="mt-[0.35rem] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {/* Pushes the footer to the bottom so a grid of tiles has its buttons
            on one line whatever the highlight text does. */}
        <div className="flex-1" />

        <div className="relative border-t border-white/6 px-5 py-4">
          <div className="figure mb-3 flex items-center justify-between text-[0.68rem] text-void-400">
            <span>
              {money(game.minBet)} – {moneyShort(game.maxBet)}
            </span>
            <span>
              {seated ? (
                <span className="text-[var(--accent)]">
                  {money(open!.chips)} on the table
                </span>
              ) : (
                <>buy in {moneyShort(game.defaultBuyIn)}</>
              )}
            </span>
          </div>

          <Button
            tone="primary"
            size="lg"
            className="w-full"
            disabled={!game.live}
            onClick={() => onSit(game)}
          >
            {!game.live ? 'Not open yet' : seated ? 'Back to the table' : 'Sit down'}
          </Button>
        </div>
      </Panel>
    </Accent>
  );
}
