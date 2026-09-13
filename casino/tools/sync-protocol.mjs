#!/usr/bin/env node
/**
 * Copies the casino protocol into the apps that speak it, and checks that the
 * copies have not drifted.
 *
 *   node casino/tools/sync-protocol.mjs            write the copies
 *   node casino/tools/sync-protocol.mjs --check    fail if any copy differs
 *
 * ------------------------------------------------------------------------
 * Why copies at all
 * ------------------------------------------------------------------------
 *
 * Every app here builds on its own, from its own folder, with its own
 * Dockerfile whose build context is that folder — which is what lets a game be
 * developed and shipped without the rest of the repository existing. A shared
 * workspace package would be reachable from a laptop and invisible from inside
 * every one of those Docker builds.
 *
 * So the protocol is vendored, and the thing that would normally make
 * vendoring a bad idea — the copies silently diverging until two of them
 * disagree about money — is handled by making divergence a test failure. Each
 * app's suite runs the check, so a protocol edit that is not synced fails in
 * the app that would have broken, which is exactly where someone will look.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const source = join(root, 'casino', 'protocol');

/**
 * Who gets what.
 *
 * A game gets the client and the types. It does not get the host, because a
 * game has no business being able to seat itself.
 *
 * The shell gets the host, the types, *and* the client — which is the one
 * asymmetry worth explaining. It is not for running: the shell never pretends
 * to be a game at runtime. It is because the shell is the only app that holds
 * both ends of the protocol, so it is the only place the protocol can be tested
 * as a protocol rather than as two halves that have each been read carefully.
 * `handshake.test.ts` there drives a real client against a real host through a
 * pair of fake windows, and an untested wire format that moves money is worse
 * than one asymmetric dependency in a build that tree-shakes it out anyway.
 */
const targets = [
  { app: 'casino/shell', files: ['protocol.ts', 'host.ts', 'client.ts', 'mode.ts', 'mode.test.ts'] },
  { app: 'TableGames/craps', files: ['protocol.ts', 'client.ts', 'mode.ts', 'mode.test.ts'] },
  { app: 'TableGames/blackjack', files: ['protocol.ts', 'client.ts', 'mode.ts', 'mode.test.ts'] },
  { app: 'TableGames/three-card-poker', files: ['protocol.ts', 'client.ts', 'mode.ts', 'mode.test.ts'] },
  { app: 'SlotsGames/DragonsShrine', files: ['protocol.ts', 'client.ts', 'mode.ts', 'mode.test.ts'] },
];

/** Where a vendored copy lands inside an app. */
const VENDOR_DIR = join('src', 'lib', 'casino');

const check = process.argv.includes('--check');

function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

let drifted = 0;
let written = 0;

for (const target of targets) {
  for (const file of target.files) {
    const from = join(source, file);
    const to = join(root, target.app, VENDOR_DIR, file);
    const body = readFileSync(from, 'utf8');

    if (check) {
      let existing;
      try {
        existing = readFileSync(to, 'utf8');
      } catch {
        console.error(`missing: ${relative(root, to)}`);
        drifted += 1;
        continue;
      }
      if (existing !== body) {
        console.error(
          `drifted: ${relative(root, to)}\n` +
            `         canonical ${digest(body)}, copy ${digest(existing)}\n` +
            `         run: pnpm run casino:sync`,
        );
        drifted += 1;
      }
      continue;
    }

    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, body);
    written += 1;
  }
}

if (check) {
  if (drifted > 0) {
    console.error(`\n${drifted} protocol ${drifted === 1 ? 'copy is' : 'copies are'} out of date.`);
    process.exit(1);
  }
  console.log(`protocol in sync across ${targets.length} apps`);
} else {
  console.log(`protocol written to ${written} files across ${targets.length} apps`);
}
