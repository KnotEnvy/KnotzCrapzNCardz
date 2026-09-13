import type { NextConfig } from 'next';

/*
 * Dragon's Shrine is a client-side game: no API routes, no server data, no
 * per-request rendering. It builds to a folder of static files, which is what
 * lets a plain nginx container serve it and what lets it be dropped on any
 * static host without a Node process running anywhere.
 *
 * The trade to remember: anything needing a server -- route handlers, server
 * actions, ISR, next/image optimisation -- fails the build rather than
 * silently not working. That is deliberate.
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
  // `/` without needing rewrite rules.
  trailingSlash: true,

  // There is no image optimiser in a static export. The whole cabinet is drawn
  // in SVG and canvas, so there is nothing for it to optimise anyway.
  images: { unoptimized: true },
};

export default nextConfig;
