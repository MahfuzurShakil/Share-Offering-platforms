'use client';

/**
 * The one door the browser uses.
 *
 * Every screen talks to `/api/v1` through this: one place that knows the
 * envelope the server answers in, one place that turns a failure into an error
 * worth showing a person, and one place a mobile app's token would be attached
 * if this file were ever shared with the apps.
 *
 * It deliberately looks like the repository layer it replaces — `get`, `post`,
 * a promise of plain data — so a screen's code reads the same after the move
 * as before it.
 */

export interface ApiFieldErrors {
  [field: string]: string;
}

/** A failure the server described on purpose. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: ApiFieldErrors,
    readonly retry_after?: number,
    readonly request_id?: string | null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** True when signing in again is the answer. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export interface ListMeta {
  page: number;
  page_size: number;
  total: number;
}

/** A page of rows, for the lists that ask the server to paginate. */
export interface Page<T> {
  rows: T[];
  meta: ListMeta;
}

const BASE = '/api/v1';

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

function toSearch(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<{ data: T; meta?: ListMeta }> {
  const response = await fetch(`${BASE}${path}${toSearch(options.query)}`, {
    method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // the session cookie is HttpOnly, so the browser must be told to send it
    credentials: 'same-origin',
    signal: options.signal,
  });

  if (response.status === 204) return { data: undefined as T };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const envelope = payload as
      | { error?: { code?: string; message?: string; fields?: ApiFieldErrors }; request_id?: string }
      | null;
    const retryAfter = Number(response.headers.get('Retry-After')) || undefined;
    throw new ApiRequestError(
      response.status,
      envelope?.error?.code ?? 'server_error',
      envelope?.error?.message ?? 'Something went wrong. Please try again.',
      envelope?.error?.fields,
      retryAfter,
      envelope?.request_id ?? null,
    );
  }

  const envelope = payload as { data: T; meta?: ListMeta };
  return { data: envelope.data, meta: envelope.meta };
}

export const api = {
  async get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return (await request<T>('GET', path, { query, signal })).data;
  },

  /** A list the server paginates: the rows and the count, together. */
  async list<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Page<T>> {
    const { data, meta } = await request<T[]>('GET', path, { query, signal });
    return {
      rows: data,
      meta: meta ?? { page: 1, page_size: data.length, total: data.length },
    };
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('POST', path, { body })).data;
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('PATCH', path, { body })).data;
  },

  async del<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('DELETE', path, { body })).data;
  },
};

/** The field errors from a failed save, for a form to show beside its inputs. */
export function fieldErrorsOf(error: unknown): ApiFieldErrors {
  return error instanceof ApiRequestError ? (error.fields ?? {}) : {};
}

/** What to show a person when something failed. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
