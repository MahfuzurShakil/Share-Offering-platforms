import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listCustomers, POST as createCustomer } from '@/app/api/v1/customers/route';
import {
  DELETE as deleteCustomer,
  GET as getCustomer,
  PATCH as patchCustomer,
} from '@/app/api/v1/customers/[id]/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The investors.
 *
 * One person, one record, across every project they buy into — so most of
 * these are about the phone number, which is what says two records are the
 * same person. The rest is what a customer page shows: what they hold, added
 * up by the database rather than by the browser.
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

suite('customers API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let viewerToken: string;

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
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Clerk', phone: '01711000002', password_hash: hash, role_code: 'accounts' },
    });
    token = await signIn('01711000001');
    viewerToken = await signIn('01711000002');
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function create(body: Json, as = token) {
    const response = await createCustomer(
      req('POST', '/api/v1/customers', { body, token: as }),
      undefined,
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  const RAHIM = { name: 'Rahim Uddin', phone: '01711 22 33 44' };

  it('creates an investor, numbers them, and keeps the number in one shape', async () => {
    const { response, body } = await create({
      ...RAHIM,
      email: 'RAHIM@example.test',
      nid: '1990123456789',
      nominee_name: 'Ayesha Rahim',
      nominee_relation: 'Wife',
      nominee_phone: '+8801811223344',
      bank_name: 'BRAC Bank',
      bank_account: '1501203456789',
      date_of_birth: '1985-04-01',
    });

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      code: `CUST-${new Date().getUTCFullYear()}-001`,
      name: 'Rahim Uddin',
      // typed with spaces, stored as it would be dialled
      phone: '01711223344',
      email: 'rahim@example.test',
      customer_type: 'investor',
      nominee_phone: '01811223344',
      date_of_birth: '1985-04-01',
    });
    expect(body.data.holdings).toMatchObject({ purchases: 0, shares: 0, value: 0, due: 0 });
  });

  it('will not let the same person be entered twice, however the number is typed', async () => {
    await create(RAHIM);

    for (const phone of ['01711223344', '+8801711223344', '8801711223344', '01711 223344']) {
      const again = await create({ name: 'Rahim U.', phone });
      expect(again.response.status, phone).toBe(422);
      expect((again.body.error as { fields: Json }).fields).toHaveProperty('phone');
    }

    // and the form can ask first, so it never gets that far
    const lookup = await listCustomers(
      req('GET', '/api/v1/customers?by_phone=%2B8801711223344', { token }),
      undefined,
    );
    const found = (await lookup.json()) as { data: { customer: Json | null } };
    expect(found.data.customer).toMatchObject({ name: 'Rahim Uddin' });

    const nobody = await listCustomers(
      req('GET', '/api/v1/customers?by_phone=01999999999', { token }),
      undefined,
    );
    expect(((await nobody.json()) as { data: { customer: Json | null } }).data.customer).toBeNull();
  });

  it('refuses a number that could not be dialled', async () => {
    const { response, body } = await create({ name: 'Nobody', phone: '12345' });
    expect(response.status).toBe(422);
    expect((body.error as { fields: Json }).fields).toHaveProperty('phone');
  });

  it('adds up what an investor holds, across projects, net of a reversal', async () => {
    const { body } = await create(RAHIM);
    const id = body.data.id as string;

    const project = await db.project.create({
      data: {
        code: 'PRJ-2026-001',
        name: 'Sea Pearl Hotel',
        sales_status: 'open',
        valuation: '1000000000.00',
        total_shares: 1000,
        valuation_date: new Date('2026-12-01T00:00:00Z'),
      },
    });
    const offering = await db.shareOffering.create({
      data: {
        code: 'OFR-2026-001',
        project_id: project.id,
        round_no: 1,
        net_asset_value: '1000000000.00',
        valuation: '1000000000.00',
        valuation_date: new Date('2026-12-01T00:00:00Z'),
        offered_pct: '50.000000',
        total_shares: 500,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        status: 'open',
      },
    });

    async function purchase(code: string, shares: number, status: 'reserved' | 'agreement_signed') {
      return db.shareSale.create({
        data: {
          code,
          offering_id: offering.id,
          project_id: project.id,
          customer_id: id,
          shares,
          share_pct: '0.100000',
          price_per_share: '1000000.00',
          total_price: `${shares * 1_000_000}.00`,
          reserved_on: new Date('2026-12-02T00:00:00Z'),
          hold_until: new Date('2026-12-09T00:00:00Z'),
          status,
        },
      });
    }

    const signed = await purchase('SHR-2026-001', 10, 'agreement_signed');
    await purchase('SHR-2026-002', 5, 'reserved');
    // a cancelled purchase holds nothing and is not counted
    const dropped = await purchase('SHR-2026-003', 7, 'reserved');
    await db.shareSale.update({ where: { id: dropped.id }, data: { status: 'cancelled' } });

    await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0001',
        sale_id: signed.id,
        paid_on: new Date('2026-12-09T00:00:00Z'),
        amount: '3000000.00',
        principal: '3000000.00',
        method: 'bank_transfer',
      },
    });
    // recorded against the wrong purchase and reversed: the net is what counts
    const wrong = await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0002',
        sale_id: signed.id,
        paid_on: new Date('2026-12-10T00:00:00Z'),
        amount: '1000000.00',
        principal: '1000000.00',
        method: 'cash',
      },
    });
    await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0003',
        sale_id: signed.id,
        paid_on: new Date('2026-12-10T00:00:00Z'),
        amount: '-1000000.00',
        principal: '-1000000.00',
        method: 'cash',
        reverses_payment_id: wrong.id,
      },
    });

    const response = await getCustomer(req('GET', `/api/v1/customers/${id}`, { token }), ctx(id));
    const read = (await response.json()) as { data: Json };

    expect(read.data.holdings).toMatchObject({
      purchases: 2,
      shares: 15,
      value: 15_000_000,
      paid: 3_000_000,
      due: 12_000_000,
    });

    // the list says the same thing, counted the same way
    const list = await listCustomers(req('GET', '/api/v1/customers', { token }), undefined);
    const rows = (await list.json()) as { data: Json[] };
    expect((rows.data[0]!.holdings as Json).shares).toBe(15);
  });

  it('filters by what they hold, and by the things people know', async () => {
    const rahim = await create({ ...RAHIM, nid: '1990123456789', profession: 'Doctor' });
    await create({ name: 'Karim Mia', phone: '01811223344', profession: 'Businessman' });

    const project = await db.project.create({
      data: { code: 'PRJ-2026-001', name: 'Sea Pearl', sales_status: 'open' },
    });
    const offering = await db.shareOffering.create({
      data: {
        code: 'OFR-2026-001',
        project_id: project.id,
        round_no: 1,
        net_asset_value: '1000.00',
        valuation: '1000.00',
        valuation_date: new Date('2026-12-01T00:00:00Z'),
        offered_pct: '1.000000',
        total_shares: 1,
        share_pct: '1.000000',
        price_per_share: '1000.00',
      },
    });
    await db.shareSale.create({
      data: {
        code: 'SHR-2026-001',
        offering_id: offering.id,
        project_id: project.id,
        customer_id: rahim.body.data.id as string,
        shares: 1,
        share_pct: '1.000000',
        price_per_share: '1000.00',
        total_price: '1000.00',
        reserved_on: new Date('2026-12-02T00:00:00Z'),
        hold_until: new Date('2026-12-09T00:00:00Z'),
        status: 'reserved',
      },
    });

    const holding = await listCustomers(
      req('GET', '/api/v1/customers?holding_state=active', { token }),
      undefined,
    );
    const holdingBody = (await holding.json()) as { data: Json[] };
    expect(holdingBody.data.map((r) => r.name)).toEqual(['Rahim Uddin']);

    const none = await listCustomers(
      req('GET', '/api/v1/customers?holding_state=none', { token }),
      undefined,
    );
    expect(((await none.json()) as { data: Json[] }).data.map((r) => r.name)).toEqual(['Karim Mia']);

    // the name box matches the code and the email too, which is what people type
    const byCode = await listCustomers(
      req('GET', `/api/v1/customers?name=CUST-${new Date().getUTCFullYear()}-002`, { token }),
      undefined,
    );
    expect(((await byCode.json()) as { data: Json[] }).data).toHaveLength(1);

    const byProfession = await listCustomers(
      req('GET', '/api/v1/customers?profession=doctor', { token }),
      undefined,
    );
    expect(((await byProfession.json()) as { data: Json[] }).data).toHaveLength(1);

    // a phone typed any way finds them
    const byPhone = await listCustomers(
      req('GET', '/api/v1/customers?phone=%2B880 1711', { token }),
      undefined,
    );
    expect(((await byPhone.json()) as { data: Json[] }).data).toHaveLength(1);
  });

  it('keeps an investor who has bought something', async () => {
    const { body } = await create(RAHIM);
    const id = body.data.id as string;

    const project = await db.project.create({
      data: { code: 'PRJ-2026-001', name: 'Sea Pearl', sales_status: 'open' },
    });
    const offering = await db.shareOffering.create({
      data: {
        code: 'OFR-2026-001',
        project_id: project.id,
        round_no: 1,
        net_asset_value: '1000.00',
        valuation: '1000.00',
        valuation_date: new Date('2026-12-01T00:00:00Z'),
        offered_pct: '1.000000',
        total_shares: 1,
        share_pct: '1.000000',
        price_per_share: '1000.00',
      },
    });
    await db.shareSale.create({
      data: {
        code: 'SHR-2026-001',
        offering_id: offering.id,
        project_id: project.id,
        customer_id: id,
        shares: 1,
        share_pct: '1.000000',
        price_per_share: '1000.00',
        total_price: '1000.00',
        reserved_on: new Date('2026-12-02T00:00:00Z'),
        hold_until: new Date('2026-12-09T00:00:00Z'),
      },
    });

    const refused = await deleteCustomer(
      req('DELETE', `/api/v1/customers/${id}`, { token }),
      ctx(id),
    );
    expect(refused.status).toBe(409);
    expect(String(((await refused.json()) as { error: Json }).error.message)).toMatch(
      /1 share purchase/,
    );
  });

  it('soft-deletes an investor who has bought nothing, with their papers', async () => {
    const { body } = await create(RAHIM);
    const id = body.data.id as string;
    await db.document.create({
      data: { entity_type: 'customer', entity_id: id, document_type: 'id_document' },
    });

    const response = await deleteCustomer(
      req('DELETE', `/api/v1/customers/${id}`, { token }),
      ctx(id),
    );
    expect(response.status).toBe(204);

    const read = await getCustomer(req('GET', `/api/v1/customers/${id}`, { token }), ctx(id));
    expect(read.status).toBe(404);
    expect(await db.document.count({ where: { entity_id: id } })).toBe(0);

    // the row is still there, with its code and its history
    const raw = await db.customer.findFirst({ where: { id }, includeDeleted: true });
    expect(raw?.deleted_at).toBeInstanceOf(Date);

    /*
     * The number is not free again: a deleted row keeps it, because the
     * database's unique index does not care that we hid the row. Said as a
     * field error somebody can act on, not as a 500 from a constraint.
     */
    const reused = await create({ name: 'Somebody Else', phone: RAHIM.phone });
    expect(reused.response.status).toBe(422);
    expect(String(((reused.body.error as { fields: Json }).fields as Json).phone)).toMatch(
      /deleted/i,
    );
  });

  it('updates only what was sent, and audits it', async () => {
    const { body } = await create(RAHIM);
    const id = body.data.id as string;

    const response = await patchCustomer(
      req('PATCH', `/api/v1/customers/${id}`, { body: { profession: 'Doctor' }, token }),
      ctx(id),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { data: Json }).toMatchObject({
      data: { name: 'Rahim Uddin', profession: 'Doctor' },
    });

    const audit = await db.auditLog.findMany({
      where: { table_name: 'customers' },
      orderBy: { at: 'asc' },
    });
    expect(audit.map((r: { action: string }) => r.action)).toEqual(['create', 'update']);
    expect(audit[1]!.after).toMatchObject({ profession: 'Doctor' });
  });

  it('lets a view-only role read but not write', async () => {
    const { body } = await create(RAHIM);
    const id = body.data.id as string;

    const read = await getCustomer(
      req('GET', `/api/v1/customers/${id}`, { token: viewerToken }),
      ctx(id),
    );
    expect(read.status).toBe(200);

    expect((await create({ name: 'Theirs', phone: '01911223344' }, viewerToken)).response.status).toBe(
      403,
    );

    const patched = await patchCustomer(
      req('PATCH', `/api/v1/customers/${id}`, { body: { name: 'Renamed' }, token: viewerToken }),
      ctx(id),
    );
    expect(patched.status).toBe(403);
  });
});
