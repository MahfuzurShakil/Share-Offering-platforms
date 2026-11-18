'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from './client';

/**
 * The query cache, one per browser tab.
 *
 * Created in state rather than at module scope: a module-level client would be
 * shared between requests on the server during rendering, which leaks one
 * person's data into another's page.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            /*
             * Retrying a 401, a 403 or a 422 is pointless — the answer will not
             * change — and retrying a 429 makes the thing it is complaining
             * about worse. Only a server error or a dropped connection is worth
             * a second try.
             */
            retry: (attempt, error) => {
              if (error instanceof ApiRequestError && error.status < 500) return false;
              return attempt < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
