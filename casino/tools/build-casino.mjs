#!/usr/bin/env node
/**
 * Builds the whole casino into `casino/dist`.
 *
 *   node casino/tools/build-casino.mjs              everything
 *   node casino/tools/build-casino.mjs craps        one game, plus the shell
 *   node casino/tools/build-casino.mjs --games-only skip the shell
 *
 * ------------------------------------------------------------------------
 * What this exists to get right
 * ------------------------------------------------------------------------
 *
 * A static export bakes its own base path into every script tag, stylesheet
 * link and asset URL in the HTML it emits. So a game that will be served from
 * `/games/craps/` has to be *built* knowing that — a bundle built for `/` and
 * served from a subpath asks the server for `/_next/...`, gets the shell's own
 * index.html back, and renders a blank page with no error anybody can see.
 *
 * That is the one thing a person assembling this by hand gets wrong, and it is
 * the reason this is a script rather than four lines in a README. Each game is
 * built with `CASINO_BASE_PATH` set to where the floor will serve it, and the
 * output lands in a layout the floor's `KNOTZ_GAMES_DIR` reads directly.
 *
 * Everything else here is bookkeeping: the protocol check first, so a drifted
 * copy fails before twenty minutes of Next builds rather than after.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const dist = join(root, 'casino', 'dist');

/**
 * Every app, where it lives, and where the floor serves it.
 *
 * The slug is the contract: it is the catalog's `slug` in
 * `casino/server/src/catalog.rs`, the directory under `KNOTZ_GAMES_DIR`, and
 * the path in the manifest. All three have to agree, and this table is where
 * they are made to.
 */
const GAMES = [
  { slug: 'craps', dir: 'TableGames/craps' },
  { slug: 'blackjack', dir: 'TableGames/blackjack' },
  { slug: 'three-card-poker', dir: 'TableGames/three-card-poker' },
  { slug: 'dragons-shrine', dir: 'SlotsGames/DragonsShrine' },
];

const SHELL = { dir: 'casino/shell' };

const args = process.argv.slice(2);
const gamesOnly = args.includes('--games-only');
const shellOnly = args.includes('--shell-only');
const named = args.filter((a) => !a.startsWith('--'));

function run(command, commandArgs, cwd, env = {}) {
  process.stdout.write(`\n\x1b[2m$ ${command} ${commandArgs.join(' ')}\x1b[0m  (${relative(root, cwd) || '.'})\n`);
  execFileSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

/** The package manager, taken from whatever is running this. */
const pm = process.env.KNOTZ_PM ?? 'pnpm';

function install(cwd) {
  // `--frozen-lockfile` is the point: a build that quietly resolves a different
  // dependency tree than the lockfile describes is not a reproducible build.
  run(pm, ['install', '--frozen-lockfile'], cwd);
}

function exported(appDir) {
  const out = join(appDir, 'out');
  try {
    if (!statSync(out).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`${relative(root, out)} is missing — did the export run?`);
  }
  if (readdirSync(out).length === 0) throw new Error(`${relative(root, out)} is empty`);
  return out;
}

/* ------------------------------------------------------------------ *
 * Go
 * ------------------------------------------------------------------ */

// A protocol copy that has drifted is a bug that would show up as one game
// disagreeing with the floor about money. Twenty seconds here, before twenty
// minutes of builds.
run('node', ['casino/tools/sync-protocol.mjs', '--check'], root);

const chosen = named.length > 0 ? GAMES.filter((g) => named.includes(g.slug)) : GAMES;
if (named.length > 0 && chosen.length !== named.length) {
  const known = GAMES.map((g) => g.slug).join(', ');
  console.error(`\nUnknown game. The floor knows: ${known}`);
  process.exit(1);
}

mkdirSync(dist, { recursive: true });

if (!shellOnly) {
  for (const game of chosen) {
    const appDir = join(root, game.dir);
    const basePath = `/games/${game.slug}`;

    install(appDir);
    run(pm, ['run', 'build'], appDir, { CASINO_BASE_PATH: basePath });

    const target = join(dist, 'games', game.slug);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(exported(appDir), target, { recursive: true });
    console.log(`\n\x1b[32m✓\x1b[0m ${game.slug} → ${relative(root, target)}  (served at ${basePath}/)`);
  }
}

if (!gamesOnly) {
  const appDir = join(root, SHELL.dir);
  install(appDir);
  run(pm, ['run', 'build'], appDir);

  const target = join(dist, 'shell');
  rmSync(target, { recursive: true, force: true });
  cpSync(exported(appDir), target, { recursive: true });
  console.log(`\n\x1b[32m✓\x1b[0m shell → ${relative(root, target)}  (served at /)`);
}

console.log(`
\x1b[1mThe casino is built.\x1b[0m Point the floor at it:

  KNOTZ_SHELL_DIR=${relative(root, join(dist, 'shell'))} \\
  KNOTZ_GAMES_DIR=${relative(root, join(dist, 'games'))} \\
  cargo run --release --manifest-path casino/server/Cargo.toml

...then open http://localhost:8090
`);
