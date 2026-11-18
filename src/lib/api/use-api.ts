'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * `useApi` — what the screens call instead of `useLiveQuery`.
 *
 * The prototype's screens read data with
 * `useLiveQuery(() => someRepository.thing(id), [id])`, which returns the data
 * or `undefined` while it is in flight. This returns exactly the same thing
 * from the server instead, so a screen changes by one line and keeps its
 * loading guard, its filters and its table:
 *
 *     const data = useLiveQuery(() => shareSaleOverview(), []);   // before
 *     const data = useApi(['share-sale', 'overview'], () => api.get(...));  // after
 *
 * Liveness is not lost, it is just no longer free: a mutation invalidates the
 * keys it touched, the window regaining focus refetches, and anything older
 * than half a minute is refetched when it is next looked at. No websockets —
 * nothing in this product needs the screen to move while nobody is touching it.
 */

export interface UseApiOptions {
  /** skip the request until something is known (an id, a filter) */
  enabled?: boolean;
  /** how long the answer is treated as fresh, in milliseconds */
  staleTime?: number;
  /** keep polling, for a screen watching something that changes on its own */
  refetchInterval?: number;
}

/**
 * Reads data. Returns `undefined` while the first request is in flight — the
 * same signal the screens already branch on.
 */
export function useApi<T>(
  key: QueryKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseApiOptions = {},
): T | undefined {
  const { data } = useQuery<T>({
    queryKey: key,
    queryFn: ({ signal }) => fetcher(signal),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime ?? 30_000,
    refetchInterval: options.refetchInterval,
  });
  return data;
}

/**
 * The same, with the request's own state when a screen needs it — a spinner on
 * a slow list, or the message from a failure.
 */
export function useApiQuery<T>(
  key: QueryKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseApiOptions = {},
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: ({ signal }) => fetcher(signal),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime ?? 30_000,
    refetchInterval: options.refetchInterval,
  });
}

/**
 * Writes data, and refreshes what the write changed.
 *
 * `invalidates` are key prefixes: `[['projects']]` refreshes every project
 * query, list and detail alike. Passing the prefix rather than exact keys is
 * deliberate — a screen should not have to know which other screens care.
 */
export function useApiMutation<TInput, TResult>(
  mutate: (input: TInput) => Promise<TResult>,
  invalidates: QueryKey[] = [],
) {
  const client = useQueryClient();
  return useMutation<TResult, unknown, TInput>({
    mutationFn: mutate,
    onSuccess: async () => {
      await Promise.all(
        invalidates.map((key) => client.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/**
 * Refreshes a set of queries by hand — after something happened elsewhere.
 *
 * The keys are serialised into the dependency list because they are written
 * inline at the call site (`useRefresh([['projects']])`), so the array itself is
 * a new object on every render while what it means has not changed.
 */
export function useRefresh(keys: QueryKey[]) {
  const client = useQueryClient();
  const fingerprint = JSON.stringify(keys);
  return useCallback(
    () => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: key }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, fingerprint],
  );
}
