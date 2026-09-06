import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['/tmp/claude-0/-home-user-KnotzCrapzNCardz/24b036a5-9042-55cc-af1c-c3ba9f5b69a2/scratchpad/*.probe.ts'],
    environment: 'node',
    testTimeout: 900000,
    disableConsoleIntercept: true,
  },
});
