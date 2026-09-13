import type { NextConfig } from 'next';

/*
 * Knotz Blackjack is a client-side game: no API routes, no server data,
 * nothing that has to be rendered per-request. So it builds to a folder of
 * static files, which is what lets a plain nginx container serve it and what
 * lets it be dropped on any static host without a Node process running
 * anywhere.
 *
 * The consequence to remember: anything needing a server — route handlers,
 * server actions, ISR, next/image optimisation — will fail the build rather
 * than silently not work. That is the intended trade.
 */

/*
 * Where this app is mounted.
 *
 * On its own it is served at the root and `CASINO_BASE_PATH` is unset, which is
 * the default and the shape every existing deployment already has. Inside the
 * casino the floor serves every game out of one origin under `/games/<slug>/`,
 * and a static export has to be *built* knowing that: every script tag, every
 * stylesheet and every asset URL in the exported HTML is absolute, so a bundle
 * built for `/` and served from `/games/craps/` asks for `/_next/...`, gets the
 * floor's own shell, and shows a blank page.
 *
 * `basePath` fixes all of them at once, which is why this is one environment
 * variable rather than a rewrite rule in front. Setting it is what the casino's
 * build does; leaving it alone is what everything else does.
 */
const basePath = process.env.CASINO_BASE_PATH?.replace(/\/$/, '') || undefined;

const nextConfig: NextConfig = {
  output: 'export',

  // Unset outside the casino; see above.
  basePath,

  // Each route becomes `<route>/index.html`, so a file server resolves a bare
  // `/` and any future `/chart` without needing rewrite rules.
  trailingSlash: true,

  // There is no image optimiser in a static export, and the card art is 54
  // PNGs served straight out of public/ by nginx.
  images: { unoptimized: true },
};

export default nextConfig;
