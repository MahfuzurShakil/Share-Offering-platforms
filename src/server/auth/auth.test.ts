import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { allows, isOwnOnly } from '@/lib/domain/permissions';
import { checkPasswordStrength, hashPassword, verifyPassword } from '@/server/auth/password';
import { OTP_MAX_ATTEMPTS, issueOtp, verifyOtp } from '@/server/auth/otp';
import { checkRate, recordAttempt } from '@/server/auth/ratelimit';
import { createSession, revokeAllSessions, revokeSession, sessionForToken } from '@/server/auth/session';
import { maskPhone, normalizePhone } from '@/server/services/auth.service';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * Signing in: the parts that are pure, and the parts only a real database can
 * answer for — a token that is stored hashed, a code that expires, a limiter
 * that counts.
 */

describe('permission vocabulary', () => {
  it('says what each level allows', () => {
    expect(allows('full', 'approve')).toBe(true);
    expect(allows('view', 'edit')).toBe(false);
    expect(allows('view', 'view')).toBe(true);
    expect(allows('create', 'create')).toBe(true);
    // "create" may add but not change what is already there
    expect(allows('create', 'edit')).toBe(false);
    // "approve" may decide but not edit the record
    expect(allows('approve', 'edit')).toBe(false);
    expect(allows('approve', 'approve')).toBe(true);
    expect(allows('own', 'edit')).toBe(true);
    expect(isOwnOnly('own')).toBe(true);
    expect(allows('none', 'view')).toBe(false);
  });
});

describe('phone numbers', () => {
  it('reads the ways people write a Bangladeshi number', () => {
    expect(normalizePhone('+8801711223344')).toBe('01711223344');
    expect(normalizePhone('880 1711 223344')).toBe('01711223344');
    expect(normalizePhone('01711-223344')).toBe('01711223344');
    expect(normalizePhone('1711223344')).toBe('01711223344');
  });

  it('shows enough of a number to recognise, not enough to use', () => {
    expect(maskPhone('01711223344')).toBe('017****3344');
    expect(maskPhone('0171122')).toBe('*******');
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery')).toBe(false);
  });

  it('treats a missing or corrupt hash as a failed sign-in, not an error', async () => {
    expect(await verifyPassword(null, 'anything')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('turns away the passwords that get accounts taken', () => {
    expect(checkPasswordStrength('short1').ok).toBe(false);
    expect(checkPasswordStrength('admin123').ok).toBe(false);
    expect(checkPasswordStrength('abcdefghijkl').ok).toBe(false); // no digits
    expect(checkPasswordStrength('Shakil2026mahfuz', ['Shakil']).ok).toBe(false);
    expect(checkPasswordStrength('nokshi-green-2026').ok).toBe(true);
  });
});

const suite = hasTestDb ? describe : describe.skip;

suite('sessions, codes and limits', () => {
  let db: TestDb;

  beforeEach(async () => {
    db ??= testDb();
    await resetDb(db);
    vi.useRealTimers();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function staffUser() {
    await db.role.create({ data: { code: 'accounts', name: 'Accounts' } });
    return db.user.create({
      data: { name: 'Rahim', phone: '01711223344', role_code: 'accounts' },
    });
  }

  describe('sessions', () => {
    it('stores only the hash of a token, never the token', async () => {
      const user = await staffUser();
      const issued = await createSession({ kind: 'staff', user_id: user.id });

      const rows = await db.session.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(issued.token);
      expect(JSON.stringify(rows)).not.toContain(issued.token);
    });

    it('recognises its own token and refuses a wrong one', async () => {
      const user = await staffUser();
      const issued = await createSession({ kind: 'staff', user_id: user.id });

      expect(await sessionForToken(issued.token)).toMatchObject({ user_id: user.id, kind: 'staff' });
      expect(await sessionForToken(`${issued.token}x`)).toBeNull();
      expect(await sessionForToken(undefined)).toBeNull();
    });

    it('stops working the moment the device is signed out', async () => {
      const user = await staffUser();
      const issued = await createSession({ kind: 'staff', user_id: user.id });
      await revokeSession(issued.id);

      expect(await sessionForToken(issued.token)).toBeNull();
    });

    it('signs every device out at once, and says how many', async () => {
      const user = await staffUser();
      const a = await createSession({ kind: 'staff', user_id: user.id, device: 'laptop' });
      const b = await createSession({ kind: 'staff', user_id: user.id, device: 'phone' });

      expect(await revokeAllSessions({ user_id: user.id })).toBe(2);
      expect(await sessionForToken(a.token)).toBeNull();
      expect(await sessionForToken(b.token)).toBeNull();
    });

    it('refuses an expired token', async () => {
      const user = await staffUser();
      const issued = await createSession({ kind: 'staff', user_id: user.id, days: 1 });
      await db.session.update({
        where: { id: issued.id },
        data: { expires_at: new Date(Date.now() - 1000) },
      });

      expect(await sessionForToken(issued.token)).toBeNull();
    });
  });

  describe('one-time codes', () => {
    it('accepts the code once and not twice', async () => {
      const { code } = await issueOtp({ phone: '01711223344', purpose: 'customer_login' });

      expect(await verifyOtp({ phone: '01711223344', purpose: 'customer_login', code })).toEqual({
        ok: true,
      });
      expect(await verifyOtp({ phone: '01711223344', purpose: 'customer_login', code })).toEqual({
        ok: false,
        reason: 'no_code',
      });
    });

    it('is no use on another number', async () => {
      const { code } = await issueOtp({ phone: '01711223344', purpose: 'customer_login' });

      expect(await verifyOtp({ phone: '01799887766', purpose: 'customer_login', code })).toEqual({
        ok: false,
        reason: 'no_code',
      });
    });

    it('stores the code hashed', async () => {
      const { code } = await issueOtp({ phone: '01711223344', purpose: 'customer_login' });
      const rows = await db.otpCode.findMany();

      expect(JSON.stringify(rows)).not.toContain(code);
    });

    it('cancels the previous code when a new one is asked for', async () => {
      const first = await issueOtp({ phone: '01711223344', purpose: 'customer_login' });
      await issueOtp({ phone: '01711223344', purpose: 'customer_login' });

      const result = await verifyOtp({
        phone: '01711223344',
        purpose: 'customer_login',
        code: first.code,
      });
      expect(result).toEqual({ ok: false, reason: 'wrong' });
    });

    it('gives up after five wrong guesses', async () => {
      await issueOtp({ phone: '01711223344', purpose: 'customer_login' });

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
        const out = await verifyOtp({
          phone: '01711223344',
          purpose: 'customer_login',
          code: '000000',
        });
        expect(out.ok).toBe(false);
      }

      expect(await verifyOtp({ phone: '01711223344', purpose: 'customer_login', code: '000000' })).toEqual(
        { ok: false, reason: 'too_many' },
      );
    });

    it('expires', async () => {
      await issueOtp({ phone: '01711223344', purpose: 'customer_login' });
      await db.otpCode.updateMany({ data: { expires_at: new Date(Date.now() - 1000) } });

      expect(await verifyOtp({ phone: '01711223344', purpose: 'customer_login', code: '123456' })).toEqual(
        { ok: false, reason: 'expired' },
      );
    });
  });

  describe('rate limiting', () => {
    it('lets five failed sign-ins through and then stops', async () => {
      const subject = { identifier: '01711223344', ip: '203.0.113.5' };

      for (let i = 0; i < 5; i += 1) {
        expect((await checkRate('login', subject)).ok).toBe(true);
        await recordAttempt('login', subject, false, 'wrong_password');
      }

      const blocked = await checkRate('login', subject);
      expect(blocked.ok).toBe(false);
      expect(blocked.retry_after).toBeGreaterThan(0);
    });

    it('does not punish somebody else on the same network for one account', async () => {
      const mine = { identifier: '01711223344', ip: '203.0.113.5' };
      for (let i = 0; i < 5; i += 1) await recordAttempt('login', mine, false);

      const theirs = { identifier: '01799887766', ip: '203.0.113.5' };
      expect((await checkRate('login', theirs)).ok).toBe(true);
    });

    it('caps how many codes one number can ask for', async () => {
      const subject = { identifier: '01711223344', ip: '203.0.113.9' };
      for (let i = 0; i < 3; i += 1) await recordAttempt('otp_request', subject, true);

      const blocked = await checkRate('otp_request', subject);
      expect(blocked.ok).toBe(false);
      expect(blocked.message).toMatch(/codes/i);
    });
  });
});
