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
    /*
     * The database suites set their fixtures up in `beforeEach`, and argon2 is
     * deliberately slow (64 MiB, three passes): two password hashes and two
     * sign-ins pass vitest's 10-second hook default on a loaded machine, which
     * showed up as a test that failed only when the whole suite ran.
     */
    hookTimeout: 30_000,
  },
});
