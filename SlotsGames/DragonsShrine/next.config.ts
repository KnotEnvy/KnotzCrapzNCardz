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
const nextConfig: NextConfig = {
  output: 'export',

  // Each route becomes `<route>/index.html`, so a file server resolves a bare
  // `/` without needing rewrite rules.
  trailingSlash: true,

  // There is no image optimiser in a static export. The whole cabinet is drawn
  // in SVG and canvas, so there is nothing for it to optimise anyway.
  images: { unoptimized: true },
};

export default nextConfig;
