import { createHash, randomInt } from 'node:crypto';
import { prisma, type Tx } from '../db/prisma';

/**
 * One-time codes, for the investors who sign in by mobile number.
 *
 * Six digits, five minutes, five tries, hashed at rest — so a code read out of
 * the database is no use, and guessing is not worth starting. Asking for a new
 * code cancels the one before it, otherwise the oldest unexpired code would go
 * on working after the investor asked for a fresh one.
 */

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;

export type OtpPurpose = 'customer_login' | 'phone_change';

function hashCode(phone: string, code: string): string {
  // the phone is in the hash, so a code is useless on another number
  return createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

function sixDigits(): string {
  // randomInt is uniform; the padding keeps 000123 a valid code
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export interface IssuedOtp {
  /** the code, to hand to the SMS sender — never stored, never logged */
  code: string;
  expires_at: Date;
}

/** Issues a code for this number, cancelling any still-live one. */
export async function issueOtp(input: {
  phone: string;
  purpose: OtpPurpose;
  ip?: string | null;
}): Promise<IssuedOtp> {
  const code = sixDigits();
  const expires_at = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await prisma.$transaction(async (tx: Tx) => {
    await tx.otpCode.updateMany({
      where: { phone: input.phone, purpose: input.purpose, consumed_at: null },
      data: { consumed_at: new Date() },
    });
    await tx.otpCode.create({
      data: {
        phone: input.phone,
        purpose: input.purpose,
        code_hash: hashCode(input.phone, code),
        expires_at,
        ip: input.ip ?? null,
      },
    });
  });

  return { code, expires_at };
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many' | 'wrong' };

/**
 * Checks a code and consumes it.
 *
 * A wrong code counts against the code's own attempt cap, which is what stops
 * ten guesses against one code; the rate limiter separately stops a thousand
 * guesses across many codes.
 */
export async function verifyOtp(input: {
  phone: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<OtpResult> {
  const row = await prisma.otpCode.findFirst({
    where: { phone: input.phone, purpose: input.purpose, consumed_at: null },
    orderBy: { created_at: 'desc' },
  });

  if (!row) return { ok: false, reason: 'no_code' };
  if (row.expires_at.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many' };

  const matches = row.code_hash === hashCode(input.phone, input.code.trim());
  if (!matches) {
    await prisma.otpCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: 'wrong' };
  }

  await prisma.otpCode.update({ where: { id: row.id }, data: { consumed_at: new Date() } });
  return { ok: true };
}

/** Clears out codes nobody can use any more. For the nightly job. */
export async function purgeOldOtps(): Promise<number> {
  const result = await prisma.otpCode.deleteMany({
    where: { expires_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return result.count;
}
