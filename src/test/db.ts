import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { withAudit } from '@/server/audit/audit';
import { withSoftDelete } from '@/server/db/soft-delete';

/**
 * A real Postgres for the tests that are about the database.
 *
 * Domain tests stay pure and need none of this. But the rules this platform
 * leans on — a code series that cannot hand out a number twice, an audit row
 * written whether or not the service remembered, an append-only log, money in
 * Decimal — are rules *Postgres* enforces. Testing them against a fake would
 * test the fake.
 *
 * `DATABASE_URL_TEST` points at its own database (`sharesale_test`), the
 * migrations are applied to it once per run, and each test starts from empty.
 */

const url = process.env.DATABASE_URL_TEST;

/** True when a test database is configured, so the suite can skip rather than fail. */
export const hasTestDb = Boolean(url);

let migrated = false;

function client() {
  if (!url) throw new Error('DATABASE_URL_TEST is not set.');
  const base = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
  return withAudit(withSoftDelete(base));
}

export type TestDb = ReturnType<typeof client>;

/** The test client, with the migrations applied on first use. */
export function testDb(): TestDb {
  if (!migrated) {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: true,
    });
    migrated = true;
  }
  return client();
}

/**
 * Empties every table. `TRUNCATE ... CASCADE` in one statement, so foreign
 * keys do not dictate an order, and identity/sequence state goes with it.
 */
export async function resetDb(db: TestDb): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t: { tablename: string }) => `"public"."${t.tablename}"`).join(', ');
  /*
   * audit_log has a trigger refusing DELETE; TRUNCATE is not a DELETE, so it
   * passes — which is the behaviour we want: the log cannot be edited row by
   * row, but a test database can be wiped.
   */
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}
