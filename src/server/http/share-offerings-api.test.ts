import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listOfferings, POST as createOffering } from '@/app/api/v1/share-offerings/route';
import {
  DELETE as deleteOffering,
  GET as getOffering,
  PATCH as patchOffering,
} from '@/app/api/v1/share-offerings/[id]/route';
import { POST as openOffering } from '@/app/api/v1/share-offerings/[id]/open/route';
import { POST as extendOffering } from '@/app/api/v1/share-offerings/[id]/extend/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * A round of shares, end to end.
 *
 * The story the plan tells (PROJECT-SHARE-SALE-PLAN.md §4): a project is
 * valued, part of it goes to the market as equal shares for a fixed window,
 * and what is left of the project stays with the owner. Each test here is one
 * sentence of that story, so a rule that is quietly dropped later shows up as
 * a sentence that stopped being true.
 */

const suite = hasTestDb ? describe : describe.skip;
type Json = Record<string, unknown>;

function req(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  init: { body?: unknown; token?: string } = {},
) {
  const headers = new Headers();
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000 + 6 * 3_600_000).toISOString().slice(0, 10);

/** The plan's own example: a hotel at ৳100 crore, half of it in 500 shares. */
const HOTEL = {
  net_asset_value: 750_000_000,
  premium_value: 250_000_000,
  valuation_date: day(0),
  offered_pct: 50,
  total_shares: 500,
  validity_days: 120,
  min_shares: 1,
  max_shares: 25,
  min_down_payment_pct: 20,
  max_installments: 20,
  installment_frequency: 'monthly' as const,
  late_fee_type: 'pct_once' as const,
  late_fee_pct: 2,
  grace_days: 7,
  hold_days: 7,
};

suite('share offerings API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let viewerToken: string;
  let projectId: string;
  let quietProjectId: string;

  async function signIn(identifier: string): Promise<string> {
    const response = await login(
      req('POST', '/api/v1/auth/login', { body: { identifier, password: 'nokshi-green-2026' } }),
      undefined,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: { token: string } }).data.token;
  }

  beforeEach(async () => {
    db ??= testDb();
    // argon2 is slow on purpose; one hash is enough for every fixture user
    hash ||= await hashPassword('nokshi-green-2026');
    await resetDb(db);
    clearPermissionCache();

    await db.role.create({
      data: {
        code: 'super_admin',
        name: 'Super Admin',
        permissions: { create: [{ module: 'share_sale', level: 'full' }] },
      },
    });
    await db.role.create({
      data: {
        code: 'accounts',
        name: 'Accounts',
        permissions: { create: [{ module: 'share_sale', level: 'view' }] },
      },
    });
    await db.user.create({
      data: {
        name: 'Mahfuz Owner',
        phone: '01711000001',
        password_hash: hash,
        role_code: 'super_admin',
      },
    });
    await db.user.create({
      data: {
        name: 'Accounts Clerk',
        phone: '01711000002',
        password_hash: hash,
        role_code: 'accounts',
      },
    });
    token = await signIn('01711000001');
    viewerToken = await signIn('01711000002');

    const selling = await db.project.create({
      data: { code: 'PRJ-2026-001', name: 'Sea Pearl Hotel', sales_status: 'open' },
    });
    projectId = selling.id;
    const quiet = await db.project.create({
      data: { code: 'PRJ-2026-002', name: 'Hilltop Land', sales_status: 'not_open' },
    });
    quietProjectId = quiet.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function create(body: Json, as = token) {
    const response = await createOffering(
      req('POST', '/api/v1/share-offerings', { body, token: as }),
      undefined,
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  const hotel = (extra: Json = {}) => ({ project_id: projectId, ...HOTEL, ...extra });

  it('works the price of a share out from the valuation, and keeps it', async () => {
    const { response, body } = await create(hotel());

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      code: `OFR-${new Date().getUTCFullYear()}-001`,
      round_no: 1,
      status: 'draft',
      // 75 crore + 25 crore = 100 crore for 100% of the hotel
      valuation: 1_000_000_000,
      // 50% in 500 shares, so one share owns 0.1% and costs 10 lakh
      share_pct: 0.1,
      price_per_share: 1_000_000,
      available_shares: 500,
      sold_shares: 0,
    });
    // a new round is nobody's promise yet: it is not on the market
    expect(body.data.opens_on).toBeNull();
  });

  it('will not let a round be written against a project that is not selling', async () => {
    const { response, body } = await create(hotel({ project_id: quietProjectId }));
    expect(response.status).toBe(409);
    expect(String((body.error as Json).message)).toMatch(/not selling/i);
  });

  it('cannot sell the project twice over, and counts what closed rounds kept', async () => {
    const first = await create(hotel({ offered_pct: 50 }));
    expect(first.response.status).toBe(201);

    // 50 + 60 is more than the whole hotel
    const tooMuch = await create(hotel({ offered_pct: 60 }));
    expect(tooMuch.response.status).toBe(422);
    expect(String((tooMuch.body.error as Json).message)).toMatch(/50% of this project is still free/);

    // the rest of it is fine
    const second = await create(hotel({ offered_pct: 50, total_shares: 250 }));
    expect(second.response.status).toBe(201);
    expect((second.body.data as Json).round_no).toBe(2);

    const free = await listOfferings(
      req('GET', `/api/v1/share-offerings?free_for_project=${projectId}`, { token }),
      undefined,
    );
    expect(((await free.json()) as { data: { free_pct: number } }).data.free_pct).toBe(0);
  });

  it('gives a closed round its unsold share back to the owner', async () => {
    const { body } = await create(hotel({ offered_pct: 50 }));
    const id = body.data.id as string;

    await openOffering(req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }), ctx(id));
    const closed = await patchOffering(
      req('PATCH', `/api/v1/share-offerings/${id}`, { body: { status: 'closed' }, token }),
      ctx(id),
    );
    expect(closed.status).toBe(200);

    /*
     * Nothing was sold, so the whole 50% went back: the owner may offer all of
     * it again. A round still open would have kept its 50% reserved.
     */
    const free = await listOfferings(
      req('GET', `/api/v1/share-offerings?free_for_project=${projectId}`, { token }),
      undefined,
    );
    expect(((await free.json()) as { data: { free_pct: number } }).data.free_pct).toBe(100);
  });

  it('opens a draft for its window, and refuses to open it twice', async () => {
    const { body } = await create(hotel({ validity_days: 120, closes_on: null }));
    const id = body.data.id as string;

    const opened = await openOffering(
      req('POST', `/api/v1/share-offerings/${id}/open`, {
        body: { opens_on: day(0) },
        token,
      }),
      ctx(id),
    );
    const open = (await opened.json()) as { data: Json };

    expect(opened.status).toBe(200);
    expect(open.data).toMatchObject({ status: 'open', opens_on: day(0), closes_on: day(119) });

    const again = await openOffering(
      req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }),
      ctx(id),
    );
    expect(again.status).toBe(409);
  });

  it('will not change an open round — its price is what buyers were shown', async () => {
    const { body } = await create(hotel());
    const id = body.data.id as string;
    await openOffering(req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }), ctx(id));

    const edited = await patchOffering(
      req('PATCH', `/api/v1/share-offerings/${id}`, {
        body: hotel({ net_asset_value: 2_000_000_000 }),
        token,
      }),
      ctx(id),
    );
    expect(edited.status).toBe(409);

    const removed = await deleteOffering(
      req('DELETE', `/api/v1/share-offerings/${id}`, { token }),
      ctx(id),
    );
    expect(removed.status).toBe(409);
  });

  it('extends an open round that ended with shares left', async () => {
    const { body } = await create(hotel());
    const id = body.data.id as string;
    await openOffering(
      req('POST', `/api/v1/share-offerings/${id}/open`, {
        body: { opens_on: day(0), closes_on: day(10) },
        token,
      }),
      ctx(id),
    );

    const extended = await extendOffering(
      req('POST', `/api/v1/share-offerings/${id}/extend`, { body: { extra_days: 30 }, token }),
      ctx(id),
    );
    expect(extended.status).toBe(200);
    expect(((await extended.json()) as { data: Json }).data.closes_on).toBe(day(40));
  });

  it('refuses to cancel a round somebody has bought into', async () => {
    const { body } = await create(hotel());
    const id = body.data.id as string;
    await openOffering(req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }), ctx(id));

    const customer = await db.customer.create({
      data: { code: 'CUST-2026-001', name: 'Rahim Uddin', phone: '01711223344' },
    });
    await db.shareSale.create({
      data: {
        code: 'SHR-2026-001',
        offering_id: id,
        project_id: projectId,
        customer_id: customer.id,
        shares: 10,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        total_price: '10000000.00',
        reserved_on: new Date(`${day(0)}T00:00:00Z`),
        hold_until: new Date(`${day(7)}T00:00:00Z`),
        status: 'reserved',
      },
    });

    const cancelled = await patchOffering(
      req('PATCH', `/api/v1/share-offerings/${id}`, { body: { status: 'cancelled' }, token }),
      ctx(id),
    );
    expect(cancelled.status).toBe(409);
    expect(String(((await cancelled.json()) as { error: Json }).error.message)).toMatch(
      /1 customer purchase holds shares/,
    );

    // and the round now says what it is holding
    const read = await getOffering(req('GET', `/api/v1/share-offerings/${id}`, { token }), ctx(id));
    expect(((await read.json()) as { data: Json }).data).toMatchObject({
      reserved_shares: 10,
      sold_shares: 0,
      available_shares: 490,
    });
  });

  it('names the term it refused', async () => {
    const { response, body } = await create(
      hotel({ total_shares: 10_000_000_000, max_shares: 0, late_fee_pct: 90 }),
    );
    expect(response.status).toBe(422);
    const fields = (body.error as { fields: Json }).fields;
    expect(Object.keys(fields)).toContain('total_shares');
  });

  it('refuses a round whose shares would cost less than a taka', async () => {
    const { response, body } = await create(
      hotel({ net_asset_value: 1000, premium_value: 0, total_shares: 500_000 }),
    );
    expect(response.status).toBe(422);
    expect((body.error as { fields: Json }).fields).toHaveProperty('total_shares');
  });

  it('lets a view-only role read rounds but not write them', async () => {
    const created = await create(hotel());
    const id = created.body.data.id as string;

    const read = await listOfferings(req('GET', '/api/v1/share-offerings', { token: viewerToken }), undefined);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { data: Json[] }).data).toHaveLength(1);

    expect((await create(hotel(), viewerToken)).response.status).toBe(403);

    const opened = await openOffering(
      req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token: viewerToken }),
      ctx(id),
    );
    expect(opened.status).toBe(403);
  });

  it('shows a scoped user only the rounds of their own projects', async () => {
    await create(hotel());
    const clerk = await db.user.findFirstOrThrow({ where: { phone: '01711000002' } });
    await db.userProjectAssignment.create({
      data: { user_id: clerk.id, project_id: quietProjectId },
    });

    const response = await listOfferings(
      req('GET', '/api/v1/share-offerings', { token: viewerToken }),
      undefined,
    );
    const body = (await response.json()) as { data: Json[]; meta: Json };
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });

  it('audits the round and what was done to it', async () => {
    const { body } = await create(hotel());
    const id = body.data.id as string;
    await openOffering(req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }), ctx(id));

    const rows = await db.auditLog.findMany({
      where: { table_name: 'share_offerings' },
      orderBy: { at: 'asc' },
    });
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['create', 'update']);
    expect(rows[0]!.record_code).toBe(`OFR-${new Date().getUTCFullYear()}-001`);
    expect(rows[1]!.after).toMatchObject({ status: 'open' });
  });
});
