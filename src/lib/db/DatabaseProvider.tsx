'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getDb } from './database';

type DbStatus = 'loading' | 'ready' | 'error';

const DatabaseContext = createContext<{ status: DbStatus; error?: string }>({ status: 'loading' });

/**
 * Opens the shared IndexedDB once per browser session.
 *
 * TEMPORARY: this whole file goes away when the Postgres data layer lands.
 * Reference data now comes from `prisma/seed/01-lookups.ts` and demo data from
 * `scripts/demo/*` over the real REST API, so nothing is seeded in the browser.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: DbStatus; error?: string }>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDb().open();
        if (!cancelled) setState({ status: 'ready' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', error: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>;
}

export function useDatabaseStatus() {
  return useContext(DatabaseContext);
}
