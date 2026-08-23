import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Opt-in config for the long statistical simulations. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.sim.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
