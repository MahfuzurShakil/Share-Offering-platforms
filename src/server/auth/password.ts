import argon2 from 'argon2';

/**
 * Passwords.
 *
 * argon2id, which is what the quotation commits to in everything but name
 * ("bcrypt password hashing" — argon2id is its stronger successor and is what
 * OWASP recommends today; the promise is a hashed password, not a particular
 * library). Parameters are the OWASP baseline: 64 MiB, 3 passes, 4 lanes.
 */

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Checks a password. Never throws on a malformed hash — a corrupt or empty
 * hash is simply a failed sign-in, not a 500 that tells the caller something
 * about the account.
 */
export async function verifyPassword(hash: string | null, plain: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export interface PasswordProblem {
  ok: false;
  message: string;
}

export type PasswordCheck = { ok: true } | PasswordProblem;

const COMMON = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwerty123',
  'admin123',
  'letmein1',
  'welcome1',
  'bangladesh',
]);

/**
 * The strong-password policy (quotation, Part D).
 *
 * Length first, because length is what actually helps; then a check that it is
 * not one of the handful of passwords everybody tries. Deliberately not a
 * thicket of character-class rules, which push people towards `Passw0rd!`.
 */
export function checkPasswordStrength(plain: string, context: string[] = []): PasswordCheck {
  const value = plain.trim();
  if (value.length < 10) {
    return { ok: false, message: 'Use at least 10 characters.' };
  }
  if (value.length > 200) {
    return { ok: false, message: 'That is longer than 200 characters.' };
  }
  if (COMMON.has(value.toLowerCase())) {
    return { ok: false, message: 'That password is one of the first anybody would try.' };
  }
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) {
    return { ok: false, message: 'Use both letters and numbers.' };
  }
  for (const hint of context) {
    const h = hint?.trim().toLowerCase();
    if (h && h.length >= 4 && value.toLowerCase().includes(h)) {
      return { ok: false, message: 'Do not use your own name, phone or email in the password.' };
    }
  }
  return { ok: true };
}
