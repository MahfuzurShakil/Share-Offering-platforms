import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { withActor } from '../audit/context';
import { AuthError, principalFrom } from '../auth/rbac';

/**
 * The shape of every reply, and the one place an error becomes a status code.
 *
 * One envelope so the typed client has one thing to unwrap, the mobile apps
 * read the same bodies as the browser, and a message a person should see is
 * never confused with a message only a developer should.
 *
 *   success → { data, meta? }
 *   failure → { error: { code, message, fields? }, request_id }
 */

export interface ListMeta {
  page: number;
  page_size: number;
  total: number;
}

export function ok<T>(data: T, meta?: ListMeta, init?: ResponseInit): NextResponse {
  return NextResponse.json(meta ? { data, meta } : { data }, init);
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'suspended'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'rate_limited'
  | 'server_error';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  suspended: 403,
  not_found: 404,
  invalid: 422,
  conflict: 409,
  rate_limited: 429,
  server_error: 500,
};

export function fail(
  code: ErrorCode,
  message: string,
  extra?: { fields?: Record<string, string>; request_id?: string; retry_after?: number },
): NextResponse {
  const body = {
    error: { code, message, ...(extra?.fields ? { fields: extra.fields } : {}) },
    request_id: extra?.request_id ?? null,
  };
  const headers: Record<string, string> = {};
  if (extra?.retry_after) headers['Retry-After'] = String(extra.retry_after);
  return NextResponse.json(body, { status: STATUS[code], headers });
}

/**
 * A failure a route raises on purpose, with the message the person reads.
 *
 * Services throw this; everything else that escapes is treated as a bug, logged
 * with its request id and answered with a flat "something went wrong" — a
 * stack trace or a database message must never reach a caller.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    /** seconds to wait, for a 429 — becomes the Retry-After header */
    readonly retry_after?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const rateLimited = (message: string, retry_after: number) =>
  new ApiError('rate_limited', message, undefined, retry_after);

export const notFound = (what = 'That record') => new ApiError('not_found', `${what} no longer exists.`);
export const invalid = (message: string, fields?: Record<string, string>) =>
  new ApiError('invalid', message, fields);
export const conflict = (message: string) => new ApiError('conflict', message);

/** Reads and validates a JSON body, turning a zod failure into field errors. */
export async function readJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw invalid('The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid('Some of what was sent is not valid.', fieldErrors(parsed.error));
  return parsed.data;
}

/** The same for query parameters. */
export function readQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  const params: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw invalid('Some of the filters are not valid.', fieldErrors(parsed.error));
  return parsed.data;
}

function fieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}

/** The caller's IP, as far as it can be known behind a proxy. */
export function ipOf(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return request.headers.get('x-real-ip')?.slice(0, 64) ?? null;
}

/**
 * Wraps a route handler: gives the request an id, puts the caller in scope so
 * every write is attributed and audited without the handler saying so, and
 * turns anything thrown into the envelope above.
 */
export function handler<C = unknown>(
  fn: (request: NextRequest, context: C) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context: C): Promise<NextResponse> => {
    const request_id = request.headers.get('x-request-id') ?? randomUUID();

    try {
      const principal = await principalFrom(request).catch((error) => {
        if (error instanceof AuthError) throw error;
        throw error;
      });

      return await withActor(
        {
          user_id: principal?.kind === 'staff' ? principal.user_id : null,
          customer_id: principal?.kind === 'customer' ? principal.customer_id : null,
          role: principal?.kind === 'staff' ? principal.role : null,
          ip: ipOf(request),
          user_agent: request.headers.get('user-agent'),
          request_id,
        },
        () => fn(request, context),
      );
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.code, error.message, {
          fields: error.fields,
          retry_after: error.retry_after,
          request_id,
        });
      }
      if (error instanceof AuthError) {
        return fail(error.code, error.message, { request_id });
      }
      console.error(`[api] ${request.method} ${request.nextUrl.pathname} ${request_id}`, error);
      return fail('server_error', 'Something went wrong. Please try again.', { request_id });
    }
  };
}
