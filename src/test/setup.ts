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

if (typeof window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}
