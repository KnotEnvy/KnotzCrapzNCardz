import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The statistical simulations run to hundreds of thousands of decisions,
    // so they are opt-in via `npm run test:stats` rather than part of the
    // default one-second feedback loop.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.sim.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
