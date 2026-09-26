#!/usr/bin/env node
/**
 * Runs the casino from `casino/dist`, without Docker.
 *
 *   pnpm run casino:serve              build first if you have not, then this
 *   pnpm run casino:serve -- --port 9000
 *   pnpm run casino:serve -- --fresh   start from empty books
 *
 * ------------------------------------------------------------------------
 *
 * This exists because the alternative is a four-line environment incantation
 * that has to be right — two directories, a database path and a port — and
 * getting `KNOTZ_GAMES_DIR` wrong produces a casino whose lobby loads and whose
 * every game frame is blank. That is a bad first five minutes, so it is a
 * script rather than a paragraph.
 *
 * It deliberately does *not* build anything. `casino:build` takes a few minutes
 * and re-running it silently on every start would be the wrong default when the
 * usual reason to run this is "I changed the server". It checks that the static
 * files exist and says what to do if they do not.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const dist = join(root, 'casino', 'dist');
const shellDir = join(dist, 'shell');
const gamesDir = join(dist, 'games');
const manifest = join(root, 'casino', 'server', 'Cargo.toml');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = flag('port', process.env.PORT ?? '8090');
const fresh = args.includes('--fresh');
/** Kept out of the repository: it is a player's wallet, not source. */
const db = flag('db', process.env.KNOTZ_DB ?? join(root, 'casino', 'dist', 'floor.db'));

/* ------------------------------------------------------------------ *
 * Is there anything to serve?
 * ------------------------------------------------------------------ */

function usable(dir) {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

const missing = [];
if (!usable(shellDir)) missing.push(relative(root, shellDir));
if (!usable(gamesDir)) missing.push(relative(root, gamesDir));

if (missing.length > 0) {
  console.error(
    `\nNothing to serve — ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing or empty.\n\n` +
      `  pnpm run casino:build\n\n` +
      `That builds the shell and all four games with the right base paths. It takes\n` +
      `a few minutes the first time and is cached after that.\n`,
  );
  process.exit(1);
}

const slugs = readdirSync(gamesDir).filter((name) => existsSync(join(gamesDir, name, 'index.html')));
if (slugs.length === 0) {
  console.error(
    `\n${relative(root, gamesDir)} has no built games in it (each needs an index.html).\n` +
      `Run \`pnpm run casino:build\` again.\n`,
  );
  process.exit(1);
}

if (fresh) {
  // `--fresh` is the "I want to see a new player's first screen" switch, and
  // it is a flag rather than a documented `rm` because the thing it deletes is
  // everybody's wallet.
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${db}${suffix}`;
    if (existsSync(path)) {
      execFileSync('rm', ['-f', path]);
    }
  }
  console.log(`\x1b[2mfresh books: ${relative(root, db)} removed\x1b[0m`);
}

mkdirSync(dirname(db), { recursive: true });

/* ------------------------------------------------------------------ *
 * Go
 * ------------------------------------------------------------------ */

console.log(`
\x1b[1mKnotz Casino\x1b[0m
  shell   ${relative(root, shellDir)}
  games   ${slugs.join(', ')}
  books   ${relative(root, db)}

Building the floor if it has changed, then opening on \x1b[36mhttp://localhost:${port}\x1b[0m
`);

/*
 * `cargo run` rather than a path to the binary: it rebuilds when the server has
 * changed and is a no-op when it has not, which is the behaviour somebody
 * iterating on the floor wants. The first run compiles the dependency tree and
 * takes a couple of minutes; every run after is seconds.
 */
const floor = spawn(
  'cargo',
  ['run', '--release', '--quiet', '--manifest-path', manifest],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      KNOTZ_SHELL_DIR: shellDir,
      KNOTZ_GAMES_DIR: gamesDir,
      KNOTZ_DB: db,
      PORT: String(port),
      RUST_LOG: process.env.RUST_LOG ?? 'knotz_floor=info,tower_http=warn,sqlx=warn',
    },
  },
);

/*
 * Forward the signal rather than dying on it. The floor drains in-flight
 * requests on SIGTERM — a cash-out interrupted halfway is the one request worth
 * waiting for — and a wrapper that exits first would orphan it mid-drain.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => floor.kill(signal));
}

floor.on('exit', (code, signal) => {
  if (signal) process.exit(0);
  if (code !== 0) {
    console.error(`\nThe floor exited with ${code}.`);
  }
  process.exit(code ?? 0);
});

floor.on('error', (err) => {
  console.error(
    `\nCould not start cargo: ${err.message}\n\n` +
      `The floor is a Rust binary, so this needs a Rust toolchain:\n` +
      `  https://rustup.rs\n\n` +
      `Or skip it entirely and use Docker:\n` +
      `  docker compose up -d --build casino\n`,
  );
  process.exit(1);
});
