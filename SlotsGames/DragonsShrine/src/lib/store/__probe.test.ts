import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createRng } from '@/lib/engine/rng';
import { spin } from '@/lib/engine/spin';
import { totalBetAt, betPerLineAt, DEFAULT_BET_INDEX, winTier } from '@/lib/engine/config';

it('probe', () => {
  const stake = { betPerLine: betPerLineAt(DEFAULT_BET_INDEX), totalBet: totalBetAt(DEFAULT_BET_INDEX) };
  const out: Record<string, unknown> = {};
  for (const seed of ['probe-1', 'probe-2', 'probe-5', 'probe-6']) {
    const rng = createRng(seed);
    const rows: string[] = [];
    for (let n = 1; n <= 45; n++) {
      const r = spin({ rng, stake, mode: 'BASE' });
      const t = winTier(r.totalWin, stake.totalBet);
      if (r.trigger || t === 'BIG' || t === 'MEGA' || t === 'EPIC' || t === 'LEGENDARY') {
        rows.push(`${n}:${r.trigger ? r.trigger.feature : t}`);
      }
    }
    out[seed] = rows;
  }
  writeFileSync('/tmp/probe2.json', JSON.stringify(out, null, 1));
});
