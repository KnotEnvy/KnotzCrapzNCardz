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
    /**
     * The suite prints a summary table of every measured edge when it
     * finishes. Vitest's default reporter swallows captured console output on
     * a passing run, so the intercept is turned off and the table goes
     * straight to the terminal — which is the whole point of running this.
     */
    disableConsoleIntercept: true,
  },
});
