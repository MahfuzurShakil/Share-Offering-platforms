/*
 * Test setup.
 *
 * `.env` is loaded so the database tests can find DATABASE_URL_TEST, and the
 * interim Dexie layer still needs a browser shim: vitest runs in Node, so
 * fake-indexeddb stands in for IndexedDB and `window` is defined for the
 * browser-only `getDb()`. Both of those go when the Dexie layer does.
 */
import 'dotenv/config';
import 'fake-indexeddb/auto';

/*
 * The server modules use one Prisma client, read from DATABASE_URL at import
 * time. Pointing that at the test database here — before any of them load — is
 * what keeps a test from writing into the development data. It is also why the
 * database tests run in a single fork: they share this one database.
 */
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

if (typeof window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}
