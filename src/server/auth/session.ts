import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db/prisma';

/**
 * Sessions.
 *
 * The token is 32 random bytes, handed out once and never stored: the row
 * keeps only its SHA-256. A leaked database row therefore cannot be replayed
 * as somebody's session, and signing a device out is one UPDATE — which is
 * why this is an opaque token and not a JWT. The quotation promises
 * "configurable session expiry, sign-out of a lost device", and a self-
 * contained token cannot do the second one.
 *
 * The same token serves the browser (in an HttpOnly cookie) and the mobile
 * apps (as a Bearer header), so there is one verifier, not two.
 */

export const SESSION_COOKIE = 'ss_session';

/** How long a session lasts, unless company settings say otherwise. */
export const SESSION_DAYS = {
  staff: 7,
  customer: 30,
} as const;

export type SessionKind = 'staff' | 'customer';

export interface IssuedSession {
  id: string;
  /** the only time the plain token exists; it is never stored */
  token: string;
  expires_at: Date;
}

export interface ActiveSession {
  id: string;
  kind: SessionKind;
  user_id: string | null;
  customer_id: string | null;
  expires_at: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare, so a wrong token leaks nothing by how long it took. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function createSession(input: {
  kind: SessionKind;
  user_id?: string | null;
  customer_id?: string | null;
  device?: string | null;
  ip?: string | null;
  days?: number;
}): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const days = input.days ?? SESSION_DAYS[input.kind];
  const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const row = await prisma.session.create({
    data: {
      kind: input.kind,
      user_id: input.user_id ?? null,
      customer_id: input.customer_id ?? null,
      token_hash: hashToken(token),
      device: input.device?.slice(0, 200) ?? null,
      ip: input.ip ?? null,
      expires_at,
    },
  });

  return { id: row.id, token, expires_at };
}

/**
 * The session a token stands for, or null.
 *
 * `last_seen_at` is only touched once a minute: every request writing a row
 * would turn a read into a write and put the session table under the load of
 * the whole application.
 */
export async function sessionForToken(token: string | undefined | null): Promise<ActiveSession | null> {
  if (!token) return null;
  const row = await prisma.session.findUnique({ where: { token_hash: hashToken(token) } });
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;

  const stale = !row.last_seen_at || Date.now() - row.last_seen_at.getTime() > 60_000;
  if (stale) {
    await prisma.session.update({ where: { id: row.id }, data: { last_seen_at: new Date() } });
  }

  return {
    id: row.id,
    kind: row.kind as SessionKind,
    user_id: row.user_id,
    customer_id: row.customer_id,
    expires_at: row.expires_at,
  };
}

/** Signs this device out. */
export async function revokeSession(id: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

/** Signs every device out — used when a password changes or an account is suspended. */
export async function revokeAllSessions(subject: {
  user_id?: string;
  customer_id?: string;
}): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      ...(subject.user_id ? { user_id: subject.user_id } : {}),
      ...(subject.customer_id ? { customer_id: subject.customer_id } : {}),
      revoked_at: null,
    },
    data: { revoked_at: new Date() },
  });
  return result.count;
}

/** The other devices this person is signed in on, newest first. */
export async function listSessions(subject: { user_id?: string; customer_id?: string }) {
  return prisma.session.findMany({
    where: {
      ...(subject.user_id ? { user_id: subject.user_id } : {}),
      ...(subject.customer_id ? { customer_id: subject.customer_id } : {}),
      revoked_at: null,
      expires_at: { gt: new Date() },
    },
    orderBy: { created_at: 'desc' },
    select: { id: true, device: true, ip: true, created_at: true, last_seen_at: true },
  });
}

/** Clears out what has expired. Called by the nightly job, not by a request. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expires_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return result.count;
}

/** The cookie a browser session is carried in. */
export function sessionCookie(token: string, expires: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  };
}

/** The cookie that clears it. */
export function clearedSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
}
