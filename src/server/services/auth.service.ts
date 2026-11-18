import { auditEvent } from '../audit/audit';
import { prisma } from '../db/prisma';
import { verifyPassword } from '../auth/password';
import { OTP_TTL_SECONDS, issueOtp, verifyOtp } from '../auth/otp';
import { checkRate, recordAttempt } from '../auth/ratelimit';
import { createSession, revokeAllSessions, revokeSession, type IssuedSession } from '../auth/session';
import { otpMessage, sendSms } from '../sms/sms';
import { ApiError, rateLimited } from '../http/respond';

/**
 * Signing in and out.
 *
 * Two doors, one session table: staff with a password, investors with a code
 * sent to their phone. What they have in common is kept here rather than in
 * the route handlers, so neither door can quietly grow a weaker rule than the
 * other — both are rate limited, both record every attempt, both leave an
 * audit row.
 *
 * What a failure says is deliberately vague: "that phone number and password
 * do not match" never reveals whether the account exists. The attempt log
 * knows the difference; the person at the screen does not.
 */

const SAME_FOR_ALL_FAILURES = 'That phone number and password do not match.';

export interface SignedIn {
  session: IssuedSession;
  user: { id: string; name: string; role: string; must_change_password: boolean };
}

/** Staff sign-in, by phone or email. */
export async function loginWithPassword(input: {
  identifier: string;
  password: string;
  ip?: string | null;
  device?: string | null;
}): Promise<SignedIn> {
  const identifier = input.identifier.trim().toLowerCase();
  const subject = { identifier, ip: input.ip };

  const rate = await checkRate('login', subject);
  if (!rate.ok) {
    throw rateLimited(rate.message ?? 'Too many attempts. Try again shortly.', rate.retry_after);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }],
    },
    select: {
      id: true,
      name: true,
      role_code: true,
      status: true,
      password_hash: true,
      must_change_password: true,
    },
  });

  /*
   * The password is verified even when there is no such user — against a dummy
   * hash — so a wrong number and a wrong password take the same time. Without
   * it, the response time alone tells somebody which numbers are accounts.
   */
  const matches = await verifyPassword(user?.password_hash ?? null, input.password);

  if (!user || !matches) {
    await recordAttempt('login', subject, false, user ? 'wrong_password' : 'no_such_user');
    throw new ApiError('unauthenticated', SAME_FOR_ALL_FAILURES);
  }

  if (user.status !== 'active') {
    await recordAttempt('login', subject, false, 'suspended');
    throw new ApiError('forbidden', 'This account has been suspended. Ask an administrator.');
  }

  const session = await createSession({
    kind: 'staff',
    user_id: user.id,
    ip: input.ip,
    device: input.device,
  });

  await prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
  await recordAttempt('login', subject, true);
  await auditEvent(prisma, 'login', {
    table_name: 'users',
    record_id: user.id,
    after: { kind: 'staff', session_id: session.id },
  });

  return {
    session,
    user: {
      id: user.id,
      name: user.name,
      role: user.role_code,
      must_change_password: user.must_change_password,
    },
  };
}

export interface OtpRequested {
  /** where it went, part-hidden: 017****5566 */
  sent_to: string;
  expires_in: number;
  /** development only, so the flow can be walked without an SMS account */
  code?: string;
}

/**
 * Masks a number for the screen: the first three and last four digits.
 *
 * Anything shorter than a full number is hidden completely — half of a
 * malformed number is not recognisable anyway, and showing it would only leak
 * what little was typed.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return '*'.repeat(digits.length);
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 7)}${digits.slice(-4)}`;
}

/**
 * An investor asks for a code.
 *
 * A number nobody knows gets the same reply as one we do: "the code is on its
 * way". Saying "no such investor" would turn this into a way of finding out
 * who holds shares, which is exactly what the data boundary is for.
 */
export async function requestCustomerOtp(input: {
  phone: string;
  ip?: string | null;
}): Promise<OtpRequested> {
  const phone = normalizePhone(input.phone);
  const subject = { identifier: phone, ip: input.ip };

  const rate = await checkRate('otp_request', subject);
  if (!rate.ok) {
    throw rateLimited(rate.message ?? 'Too many codes asked for.', rate.retry_after);
  }

  const customer = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM customers WHERE regexp_replace(phone, '\\D', '', 'g') = ${phone} LIMIT 1
  `.catch(() => [] as { id: string }[]);

  const reply: OtpRequested = {
    sent_to: maskPhone(phone),
    expires_in: OTP_TTL_SECONDS,
  };

  await recordAttempt('otp_request', subject, true, customer.length ? 'known' : 'unknown');
  if (customer.length === 0) return reply;

  const { code } = await issueOtp({ phone, purpose: 'customer_login', ip: input.ip });
  const settings = await prisma.companySettings.findFirst({ select: { company_name: true } });
  await sendSms({
    to: phone,
    purpose: 'customer_login',
    text: otpMessage(code, settings?.company_name ?? 'the company', OTP_TTL_SECONDS / 60),
  });

  // never in production: the code is the credential
  if (process.env.NODE_ENV !== 'production' && process.env.OTP_IN_RESPONSE === 'true') {
    reply.code = code;
  }
  return reply;
}

export interface CustomerSignedIn {
  session: IssuedSession;
  customer: { id: string };
}

/** An investor signs in with the code. */
export async function verifyCustomerOtp(input: {
  phone: string;
  code: string;
  ip?: string | null;
  device?: string | null;
}): Promise<CustomerSignedIn> {
  const phone = normalizePhone(input.phone);
  const subject = { identifier: phone, ip: input.ip };

  const rate = await checkRate('otp_verify', subject);
  if (!rate.ok) {
    throw rateLimited(rate.message ?? 'Too many attempts.', rate.retry_after);
  }

  const result = await verifyOtp({ phone, purpose: 'customer_login', code: input.code });
  if (!result.ok) {
    await recordAttempt('otp_verify', subject, false, result.reason);
    throw new ApiError(
      'unauthenticated',
      result.reason === 'expired'
        ? 'That code has expired. Ask for a new one.'
        : result.reason === 'too_many'
          ? 'That code has been tried too many times. Ask for a new one.'
          : 'That code is not right.',
    );
  }

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM customers WHERE regexp_replace(phone, '\\D', '', 'g') = ${phone} LIMIT 1
  `;
  const customer = rows[0];
  if (!customer) {
    await recordAttempt('otp_verify', subject, false, 'no_customer');
    throw new ApiError('unauthenticated', 'That code is not right.');
  }

  const session = await createSession({
    kind: 'customer',
    customer_id: customer.id,
    ip: input.ip,
    device: input.device,
  });

  await recordAttempt('otp_verify', subject, true);
  await auditEvent(prisma, 'login', {
    table_name: 'customers',
    record_id: customer.id,
    after: { kind: 'customer', session_id: session.id },
  });

  return { session, customer: { id: customer.id } };
}

/** Signs this device out. */
export async function logout(session_id: string, subject: { user_id?: string | null; customer_id?: string | null }): Promise<void> {
  await revokeSession(session_id);
  await auditEvent(prisma, 'logout', {
    table_name: subject.user_id ? 'users' : 'customers',
    record_id: subject.user_id ?? subject.customer_id ?? null,
    after: { session_id },
  });
}

/** Signs every device out, and says how many there were. */
export async function logoutEverywhere(subject: {
  user_id?: string;
  customer_id?: string;
}): Promise<number> {
  const count = await revokeAllSessions(subject);
  await auditEvent(prisma, 'logout', {
    table_name: subject.user_id ? 'users' : 'customers',
    record_id: subject.user_id ?? subject.customer_id ?? null,
    after: { sessions_revoked: count },
  });
  return count;
}

/** Digits only, with the leading country code taken off a Bangladeshi number. */
export function normalizePhone(input: string): string {
  let digits = (input ?? '').replace(/\D/g, '');
  // +8801711223344 and 8801711223344 are the same number as 01711223344
  if (digits.startsWith('880')) digits = digits.slice(3);
  // a number typed without its leading zero: 1711223344
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  return digits;
}
