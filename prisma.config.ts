import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma's own configuration. `package.json#prisma` is deprecated and goes
 * away in Prisma 7, so the seed command lives here.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'npx tsx prisma/seed/01-lookups.ts',
  },
});
