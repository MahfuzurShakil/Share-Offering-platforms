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
import { PATCH as patchProject } from '@/app/api/v1/projects/[id]/route';
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

/**
 * The plan's own example, as the two halves it is now: the hotel is valued at
 * ৳100 crore and cut into 1000 shares (the project's own figures, §4 step 1),
 * and round 1 offers 500 of those shares (§4 step 2).
 */
const VALUATION = {
  valuation: '1000000000.00',
  total_shares: 1000,
  valuation_date: new Date(`${day(0)}T00:00:00Z`),
};

const HOTEL = {
  premium_value: 0,
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
        permissions: {
          create: [
            { module: 'share_sale', level: 'full' },
            // the valuation lives on the project, so this suite touches both
            { module: 'project', level: 'full' },
          ],
        },
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
      data: {
        code: 'PRJ-2026-001',
        name: 'Sea Pearl Hotel',
        sales_status: 'open',
        ...VALUATION,
      },
    });
    projectId = selling.id;
    const quiet = await db.project.create({
      data: {
        code: 'PRJ-2026-002',
        name: 'Hilltop Land',
        sales_status: 'not_open',
        ...VALUATION,
      },
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

  it('prices a share from the project, and adds the round’s premium', async () => {
    const { response, body } = await create(hotel());

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      code: `OFR-${new Date().getUTCFullYear()}-001`,
      round_no: 1,
      status: 'draft',
      // the project's own: 100 crore cut into 1000 shares
      valuation: 1_000_000_000,
      share_pct: 0.1,
      price_per_share: 1_000_000,
      // this round offers 500 of those shares, which is half the project
      offered_pct: 50,
      available_shares: 500,
      sold_shares: 0,
    });
    // a new round is nobody's promise yet: it is not on the market
    expect(body.data.opens_on).toBeNull();

    /*
     * A premium is the round's own, and the only thing that moves the price:
     * 25% on top makes the same 0.1% share cost 12.5 lakh. What it buys does
     * not change — a share is still a thousandth of the hotel.
     */
    const premium = await create(hotel({ premium_value: 250_000_000 }));
    expect(premium.body.data).toMatchObject({
      valuation: 1_250_000_000,
      share_pct: 0.1,
      price_per_share: 1_250_000,
    });
  });

  it('refuses a round on a project that has not been valued', async () => {
    const unvalued = await db.project.create({
      data: { code: 'PRJ-2026-003', name: 'Unvalued Plot', sales_status: 'open' },
    });
    const { response, body } = await create(hotel({ project_id: unvalued.id }));

    expect(response.status).toBe(409);
    expect(String((body.error as Json).message)).toMatch(/no valuation yet/i);
  });

  it('fixes the project’s valuation once a round is on the market', async () => {
    const { body } = await create(hotel());
    const id = body.data.id as string;

    // still a draft: the owner can still change what the project is worth
    const beforeOpening = await patchProject(
      req('PATCH', `/api/v1/projects/${projectId}`, {
        body: { valuation: 1_200_000_000 },
        token,
      }),
      ctx(projectId),
    );
    expect(beforeOpening.status).toBe(200);

    await openOffering(req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }), ctx(id));

    const afterOpening = await patchProject(
      req('PATCH', `/api/v1/projects/${projectId}`, {
        body: { valuation: 2_000_000_000 },
        token,
      }),
      ctx(projectId),
    );
    expect(afterOpening.status).toBe(409);
    expect(String(((await afterOpening.json()) as { error: Json }).error.message)).toMatch(
      /valuation is fixed/i,
    );

    // and the round it priced keeps what it was given
    const read = await getOffering(req('GET', `/api/v1/share-offerings/${id}`, { token }), ctx(id));
    expect(((await read.json()) as { data: Json }).data.price_per_share).toBe(1_200_000);
  });

  it('will not let a round be written against a project that is not selling', async () => {
    const { response, body } = await create(hotel({ project_id: quietProjectId }));
    expect(response.status).toBe(409);
    expect(String((body.error as Json).message)).toMatch(/not selling/i);
  });

  it('cannot sell the project twice over, and counts in the project’s shares', async () => {
    const first = await create(hotel({ total_shares: 500 }));
    expect(first.response.status).toBe(201);

    // 500 + 600 is more than the thousand shares the hotel has
    const tooMuch = await create(hotel({ total_shares: 600 }));
    expect(tooMuch.response.status).toBe(422);
    expect(String((tooMuch.body.error as Json).message)).toMatch(/Only 500 of this project/);

    // the rest of them is fine
    const second = await create(hotel({ total_shares: 500 }));
    expect(second.response.status).toBe(201);
    expect((second.body.data as Json).round_no).toBe(2);

    const room = await listOfferings(
      req('GET', `/api/v1/share-offerings?free_for_project=${projectId}`, { token }),
      undefined,
    );
    expect(((await room.json()) as { data: Json }).data).toMatchObject({
      total_shares: 1000,
      taken: 1000,
      free: 0,
    });
  });

  it('gives a closed round its unsold shares back to the owner', async () => {
    const { body } = await create(hotel({ total_shares: 500 }));
    const id = body.data.id as string;

    await openOffering(req('POST', `/api/v1/share-offerings/${id}/open`, { body: {}, token }), ctx(id));
    const closed = await patchOffering(
      req('PATCH', `/api/v1/share-offerings/${id}`, { body: { status: 'closed' }, token }),
      ctx(id),
    );
    expect(closed.status).toBe(200);

    /*
     * Nothing was sold, so all 500 went back: the owner may offer them again.
     * A round still open would have kept them.
     */
    const room = await listOfferings(
      req('GET', `/api/v1/share-offerings?free_for_project=${projectId}`, { token }),
      undefined,
    );
    expect(((await room.json()) as { data: Json }).data).toMatchObject({ free: 1000, taken: 0 });
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
        body: hotel({ premium_value: 500_000_000 }),
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
    const { response, body } = await create(hotel({ max_shares: 0, late_fee_pct: 90 }));
    expect(response.status).toBe(422);
    const fields = (body.error as { fields: Json }).fields;
    expect(Object.keys(fields).length).toBeGreaterThan(0);
  });

  it('refuses a round that offers more shares than one customer may hold', async () => {
    const { response, body } = await create(hotel({ total_shares: 10, max_shares: 50 }));
    expect(response.status).toBe(422);
    expect((body.error as { fields: Json }).fields).toHaveProperty('max_shares');
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
