import type { NextConfig } from 'next';

/*
 * The casino shell is a client-side app talking to the floor's API, so it
 * builds to static files exactly as the four games do. The floor's Rust binary
 * serves this at `/` and each game under `/games/<slug>/`, which is what makes
 * the whole casino one origin: no CORS, no cookie-domain puzzle, and a game
 * frame that is same-origin with the shell hosting it.
 *
 * The trade to remember, same as the games: anything needing a server — route
 * handlers, server actions, ISR, next/image optimisation — fails the build
 * rather than silently not working.
 */
const nextConfig: NextConfig = {
  output: 'export',

  // `/play/` resolves to `play/index.html` without a rewrite rule, which is
  // what lets a plain file server handle a reload on a deep link.
  trailingSlash: true,

  images: { unoptimized: true },
};

export default nextConfig;
