import { prisma } from '../db/prisma';

/**
 * Rate limiting, in Postgres.
 *
 * A fixed window counted from `auth_attempts`, which the platform records
 * anyway for the "who tried to get in" question the quotation answers. No
 * Redis: one fewer service for the client to run and pay for, and at this
 * scale — a few hundred sign-ins a day — a counted index is quicker than the
 * network hop would be.
 *
 * Every limit is per identifier **and** per IP: one stops somebody grinding a
 * single account, the other stops one machine working through many.
 */

export type AttemptKind = 'login' | 'otp_request' | 'otp_verify';

interface Limit {
  /** how many are allowed */
  max: number;
  /** over how long, in seconds */
  window: number;
}

export const LIMITS: Record<AttemptKind, { identifier: Limit; ip: Limit; daily?: Limit }> = {
  login: {
    identifier: { max: 5, window: 15 * 60 },
    ip: { max: 20, window: 15 * 60 },
  },
  otp_request: {
    // an SMS costs money and a code is six digits: asking for one is the
    // expensive half, so it is the tighter limit
    identifier: { max: 3, window: 10 * 60 },
    ip: { max: 10, window: 10 * 60 },
    daily: { max: 10, window: 24 * 60 * 60 },
  },
  otp_verify: {
    identifier: { max: 5, window: 10 * 60 },
    ip: { max: 30, window: 10 * 60 },
  },
};

export interface RateDecision {
  ok: boolean;
  /** seconds to wait, when it is not ok */
  retry_after: number;
  message?: string;
}

const OK: RateDecision = { ok: true, retry_after: 0 };

async function countSince(
  kind: AttemptKind,
  where: { identifier?: string | null; ip?: string | null },
  seconds: number,
): Promise<number> {
  return prisma.authAttempt.count({
    where: {
      kind,
      ...(where.identifier ? { identifier: where.identifier } : {}),
      ...(where.ip ? { ip: where.ip } : {}),
      created_at: { gte: new Date(Date.now() - seconds * 1000) },
    },
  });
}

/**
 * Whether this attempt may go ahead.
 *
 * Only failed attempts count towards the per-identifier limit, so somebody
 * signing in and out legitimately is never locked out; an OTP *request* counts
 * whatever the outcome, because the cost is the SMS itself.
 */
export async function checkRate(
  kind: AttemptKind,
  subject: { identifier?: string | null; ip?: string | null },
): Promise<RateDecision> {
  const limit = LIMITS[kind];

  if (subject.identifier) {
    const used = await countSince(kind, { identifier: subject.identifier }, limit.identifier.window);
    if (used >= limit.identifier.max) {
      return {
        ok: false,
        retry_after: limit.identifier.window,
        message:
          kind === 'otp_request'
            ? 'Too many codes asked for. Wait a few minutes and try again.'
            : 'Too many attempts. Wait a few minutes and try again.',
      };
    }
    if (limit.daily) {
      const today = await countSince(kind, { identifier: subject.identifier }, limit.daily.window);
      if (today >= limit.daily.max) {
        return {
          ok: false,
          retry_after: limit.daily.window,
          message: 'Too many codes today. Please call the office.',
        };
      }
    }
  }

  if (subject.ip) {
    const used = await countSince(kind, { ip: subject.ip }, limit.ip.window);
    if (used >= limit.ip.max) {
      return { ok: false, retry_after: limit.ip.window, message: 'Too many attempts from here.' };
    }
  }

  return OK;
}

/** Records an attempt, for the limiter and for the record of who tried. */
export async function recordAttempt(
  kind: AttemptKind,
  subject: { identifier?: string | null; ip?: string | null },
  ok: boolean,
  reason?: string,
): Promise<void> {
  await prisma.authAttempt.create({
    data: {
      kind,
      identifier: subject.identifier?.slice(0, 200) ?? null,
      ip: subject.ip ?? null,
      ok,
      reason: reason?.slice(0, 120) ?? null,
    },
  });
}

/**
 * Forgets old attempts. The limiter only looks a day back, but the rows are
 * also the "who tried to get in" record, so they are kept for 90 days.
 */
export async function purgeOldAttempts(days = 90): Promise<number> {
  const result = await prisma.authAttempt.deleteMany({
    where: { created_at: { lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } },
  });
  return result.count;
}
