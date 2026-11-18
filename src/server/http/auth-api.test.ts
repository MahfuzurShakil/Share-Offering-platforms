import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as otpRequest } from '@/app/api/v1/auth/otp/request/route';
import { GET as sessions } from '@/app/api/v1/auth/sessions/route';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hashPassword } from '@/server/auth/password';
import { SESSION_COOKIE } from '@/server/auth/session';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The auth API end to end: a real request in, a real reply out, against the
 * real database. Handlers are called directly rather than over a socket — the
 * same code Next runs, without a server to start.
 */

const suite = hasTestDb ? describe : describe.skip;

function post(path: string, body: unknown, init?: { token?: string; cookie?: string }) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init?.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init?.cookie) headers.set('cookie', `${SESSION_COOKIE}=${init.cookie}`);
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function get(path: string, init?: { token?: string; cookie?: string }) {
  const headers = new Headers();
  if (init?.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init?.cookie) headers.set('cookie', `${SESSION_COOKIE}=${init.cookie}`);
  return new NextRequest(`http://localhost${path}`, { method: 'GET', headers });
}

suite('auth API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db ??= testDb();
    await resetDb(db);
    clearPermissionCache();

    await db.role.create({
      data: {
        code: 'accounts',
        name: 'Accounts',
        permissions: {
          create: [
            { module: 'finance_collection', level: 'full' },
            { module: 'project', level: 'view' },
            { module: 'user_management', level: 'none' },
          ],
        },
      },
    });
    await db.user.create({
      data: {
        name: 'Rahim Uddin',
        phone: '01711223344',
        email: 'rahim@example.test',
        password_hash: await hashPassword('nokshi-green-2026'),
        role_code: 'accounts',
      },
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('signs a staff member in, by phone or email, and sets an HttpOnly cookie', async () => {
    const response = await login(
      post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
      undefined,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user).toMatchObject({ name: 'Rahim Uddin', role: 'accounts' });
    expect(body.data.token).toBeTypeOf('string');

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');

    const byEmail = await login(
      post('/api/v1/auth/login', { identifier: 'RAHIM@example.test', password: 'nokshi-green-2026' }),
      undefined,
    );
    expect(byEmail.status).toBe(200);
  });

  it('says the same thing about a wrong password and an account that does not exist', async () => {
    const wrongPassword = await login(
      post('/api/v1/auth/login', { identifier: '01711223344', password: 'not-it-at-all' }),
      undefined,
    );
    const noAccount = await login(
      post('/api/v1/auth/login', { identifier: '01999999999', password: 'not-it-at-all' }),
      undefined,
    );

    expect(wrongPassword.status).toBe(401);
    expect(noAccount.status).toBe(401);
    expect((await wrongPassword.json()).error.message).toBe(
      (await noAccount.json()).error.message,
    );
  });

  it('refuses a suspended account, and says why', async () => {
    await db.user.updateMany({ data: { status: 'suspended' } });

    const response = await login(
      post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
      undefined,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toMatch(/suspended/i);
  });

  it('answers 422 with per-field messages when the body is wrong', async () => {
    const response = await login(post('/api/v1/auth/login', { identifier: 'x' }), undefined);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('invalid');
    expect(body.error.fields).toHaveProperty('password');
    expect(body.request_id).toBeTypeOf('string');
  });

  it('tells the signed-in user what they may do, from the role rows', async () => {
    const signedIn = await (
      await login(
        post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
        undefined,
      )
    ).json();

    const response = await me(get('/api/v1/auth/me', { token: signedIn.data.token }), undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.permissions).toMatchObject({
      finance_collection: 'full',
      project: 'view',
      user_management: 'none',
      // a module with no row at all is 'none', not undefined
      website: 'none',
    });
  });

  it('refuses a request with no session, and one with a made-up token', async () => {
    expect((await me(get('/api/v1/auth/me'), undefined)).status).toBe(401);
    expect((await me(get('/api/v1/auth/me', { token: 'not-a-real-token' }), undefined)).status).toBe(
      401,
    );
  });

  it('takes the session from a cookie as readily as from a header', async () => {
    const signedIn = await (
      await login(
        post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
        undefined,
      )
    ).json();

    const response = await me(get('/api/v1/auth/me', { cookie: signedIn.data.token }), undefined);
    expect(response.status).toBe(200);
  });

  it('signs out, and the token stops working at once', async () => {
    const signedIn = await (
      await login(
        post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
        undefined,
      )
    ).json();
    const token = signedIn.data.token;

    expect((await me(get('/api/v1/auth/me', { token }), undefined)).status).toBe(200);

    const out = await logout(post('/api/v1/auth/logout', {}, { token }), undefined);
    expect(out.status).toBe(200);
    expect((await out.json()).data.signed_out).toBe(1);

    expect((await me(get('/api/v1/auth/me', { token }), undefined)).status).toBe(401);
  });

  it('lists the devices signed in, marking this one', async () => {
    const first = await (
      await login(
        post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
        undefined,
      )
    ).json();
    await login(
      post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
      undefined,
    );

    const response = await sessions(
      get('/api/v1/auth/sessions', { token: first.data.token }),
      undefined,
    );
    const body = await response.json();

    expect(body.data).toHaveLength(2);
    expect(body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('answers an unknown number the same way as a known one when a code is asked for', async () => {
    const unknown = await otpRequest(
      post('/api/v1/auth/otp/request', { phone: '01999999999' }),
      undefined,
    );
    const body = await unknown.json();

    expect(unknown.status).toBe(200);
    // the mask is the only thing that differs, because it is the number typed
    expect(body.data.sent_to).toBe('019****9999');
    expect(body.data.expires_in).toBeGreaterThan(0);
  });

  it('stops the sixth wrong password in a row', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login(
        post('/api/v1/auth/login', { identifier: '01711223344', password: 'wrong-one-here' }),
        undefined,
      );
    }

    const blocked = await login(
      post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
      undefined,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('writes a login to the audit trail, with the session it opened', async () => {
    await login(
      post('/api/v1/auth/login', { identifier: '01711223344', password: 'nokshi-green-2026' }),
      undefined,
    );

    const logs = await db.auditLog.findMany({ where: { action: 'login' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].table_name).toBe('users');
    expect(JSON.stringify(logs[0].after)).toContain('session_id');
  });
});
