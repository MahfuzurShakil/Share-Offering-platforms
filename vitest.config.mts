import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    /*
     * The database tests talk to a real Postgres and truncate between cases,
     * so they cannot run beside each other in separate workers.
     */
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
  },
});
