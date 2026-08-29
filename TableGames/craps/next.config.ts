import type { NextConfig } from 'next';

/*
 * Knotz Craps is a client-side game: no API routes, no server data, nothing
 * that has to be rendered per-request. So it builds to a folder of static
 * files, which is what lets a plain nginx container serve it and what lets it
 * be dropped on any static host without a Node process running anywhere.
 *
 * The consequence to remember: anything needing a server — route handlers,
 * server actions, ISR, next/image optimisation — will fail the build rather
 * than silently not work. That is the intended trade.
 */
const nextConfig: NextConfig = {
  output: 'export',

  // Each route becomes `<route>/index.html`, so a file server resolves a bare
  // `/` and any future `/blackjack` without needing rewrite rules.
  trailingSlash: true,

  // There is no image optimiser in a static export. No next/image today, but
  // this keeps the build honest if one ever lands.
  images: { unoptimized: true },
};

export default nextConfig;
