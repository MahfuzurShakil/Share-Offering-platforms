import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listSales, POST as reserve } from '@/app/api/v1/share-sales/route';
import { GET as getSale } from '@/app/api/v1/share-sales/[id]/route';
import { POST as signAgreement } from '@/app/api/v1/share-sales/[id]/sign/route';
import { PATCH as patchStatus } from '@/app/api/v1/share-sales/[id]/status/route';
import {
  PATCH as reversePayment,
  POST as recordPayment,
} from '@/app/api/v1/share-sales/[id]/payments/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * A share purchase, from the hold to the last receipt.
 *
 * This is the money, so these tests are about arithmetic that must not drift:
 * a schedule that adds back up to the price, a payment that pays the late fee
 * before the installment, and a receipt that cannot be edited — only reversed.
 */

const suite = hasTestDb ? describe : describe.skip;
type Json = Record<string, unknown>;

function req(
  method: 'GET' | 'POST' | 'PATCH',
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

suite('share sales API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let salesToken: string;
  let projectId: string;
  let offeringId: string;
  let customerId: string;

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
        permissions: {
          create: [
            { module: 'share_sale', level: 'full' },
            { module: 'finance_collection', level: 'full' },
            { module: 'project', level: 'full' },
          ],
        },
      },
    });
    /* the sales desk may sign an agreement but may not say money arrived */
    await db.role.create({
      data: {
        code: 'sales',
        name: 'Sales',
        permissions: {
          create: [
            { module: 'share_sale', level: 'full' },
            { module: 'finance_collection', level: 'view' },
          ],
        },
      },
    });
    await db.user.create({
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Sales Lead', phone: '01711000003', password_hash: hash, role_code: 'sales' },
    });
    token = await signIn('01711000001');
    salesToken = await signIn('01711000003');

    const project = await db.project.create({
      data: {
        code: 'PRJ-2026-001',
        name: 'Sea Pearl Hotel',
        sales_status: 'open',
        valuation: '1000000000.00',
        total_shares: 1000,
        valuation_date: new Date(`${day(0)}T00:00:00Z`),
      },
    });
    projectId = project.id;

    /* 500 shares at ৳10 lakh, 20% down, up to 20 monthly, 2% after 7 days */
    const offering = await db.shareOffering.create({
      data: {
        code: 'OFR-2026-001',
        project_id: projectId,
        round_no: 1,
        net_asset_value: '1000000000.00',
        valuation: '1000000000.00',
        valuation_date: new Date(`${day(0)}T00:00:00Z`),
        offered_pct: '50.000000',
        total_shares: 500,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        min_shares: 1,
        max_shares: 25,
        min_down_payment_pct: '20.000',
        max_installments: 20,
        late_fee_type: 'pct_once',
        late_fee_pct: '2.000',
        grace_days: 7,
        hold_days: 7,
        status: 'open',
        opens_on: new Date(`${day(-1)}T00:00:00Z`),
        closes_on: new Date(`${day(120)}T00:00:00Z`),
      },
    });
    offeringId = offering.id;

    const customer = await db.customer.create({
      data: {
        code: 'CUST-2026-001',
        name: 'Rahim Uddin',
        phone: '01711223344',
        nid: '1990123456789',
        father_or_spouse_name: 'Abdul Uddin',
        address: 'Bashundhara R/A, Dhaka',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const PLAN = { shares: 10, down_payment_pct: 20, installment_count: 4 };

  async function hold(extra: Json = {}, as = token) {
    const response = await reserve(
      req('POST', '/api/v1/share-sales', {
        body: { offering_id: offeringId, customer_id: customerId, ...PLAN, ...extra },
        token: as,
      }),
      undefined,
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  async function sign(id: string, body: Json = {}, as = token) {
    const response = await signAgreement(
      req('POST', `/api/v1/share-sales/${id}/sign`, {
        body: { agreement_date: day(0), first_due_date: day(30), ...body },
        token: as,
      }),
      ctx(id),
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  async function pay(id: string, body: Json, as = token) {
    const response = await recordPayment(
      req('POST', `/api/v1/share-sales/${id}/payments`, { body, token: as }),
      ctx(id),
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  it('holds shares for an investor, priced from the round', async () => {
    const { response, body } = await hold();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      code: `SHR-${new Date().getUTCFullYear()}-001`,
      status: 'reserved',
      shares: 10,
      // ten shares of a thousandth each
      share_pct: 1,
      price_per_share: 1_000_000,
      total_price: 10_000_000,
      down_payment: 2_000_000,
      customer_name: 'Rahim Uddin',
      hold_until: day(7),
    });
    // nothing is scheduled until the agreement is signed
    expect(body.data.schedule).toEqual([]);

    // and the round says so
    const list = await listSales(req('GET', '/api/v1/share-sales', { token }), undefined);
    expect(((await list.json()) as { data: Json[] }).data).toHaveLength(1);
  });

  it('will not hold more than the round or the customer may have', async () => {
    const tooMany = await hold({ shares: 26 });
    expect(tooMany.response.status).toBe(422);
    expect((tooMany.body.error as { fields: Json }).fields).toHaveProperty('shares');

    const tooLittleDown = await hold({ down_payment_pct: 5 });
    expect(tooLittleDown.response.status).toBe(422);
    expect((tooLittleDown.body.error as { fields: Json }).fields).toHaveProperty(
      'down_payment_pct',
    );

    const tooManyInstallments = await hold({ installment_count: 40 });
    expect(tooManyInstallments.response.status).toBe(422);

    // 25 is the most one customer may hold here, in one purchase or several
    await hold({ shares: 20 });
    const over = await hold({ shares: 10 });
    expect(over.response.status).toBe(422);
    expect(String((over.body.error as Json).message)).toMatch(/already holds 20/);
  });

  it('refuses to reserve from a round that is not open', async () => {
    await db.shareOffering.update({ where: { id: offeringId }, data: { status: 'closed' } });
    const { response } = await hold();
    expect(response.status).toBe(409);
  });

  it('writes a schedule that adds back up to the price', async () => {
    const { body } = await hold();
    const id = body.data.id as string;

    const signed = await sign(id);
    expect(signed.response.status).toBe(200);
    expect(signed.body.data).toMatchObject({
      status: 'agreement_signed',
      agreement_no: `AGR-${new Date().getUTCFullYear()}-001`,
      agreement_date: day(0),
      first_due_date: day(30),
    });

    const schedule = signed.body.data.schedule as Json[];
    // the down payment on the signing day, then four monthly installments
    expect(schedule).toHaveLength(5);
    expect(schedule[0]).toMatchObject({ seq: 0, label: 'Down payment', amount: 2_000_000 });
    expect(schedule[1]).toMatchObject({ seq: 1, due_date: day(30), amount: 2_000_000 });
    expect(schedule.reduce((t, r) => t + (r.amount as number), 0)).toBe(10_000_000);
  });

  it('refuses to sign until the customer is named as the agreement names them', async () => {
    await db.customer.update({
      where: { id: customerId },
      data: { father_or_spouse_name: null },
    });
    const { body } = await hold();
    const id = body.data.id as string;

    const refused = await sign(id);
    expect(refused.response.status).toBe(409);
    expect(String((refused.body.error as Json).message)).toMatch(/father/i);
  });

  it('refuses a signing day in the future, or a first installment before it', async () => {
    const { body } = await hold();
    const id = body.data.id as string;

    expect((await sign(id, { agreement_date: day(3) })).response.status).toBe(422);
    expect((await sign(id, { first_due_date: day(-1) })).response.status).toBe(422);
  });

  it('re-agrees the plan at the table, and rewrites the schedule from it', async () => {
    const { body } = await hold();
    const id = body.data.id as string;

    const signed = await sign(id, {
      terms: { shares: 5, down_payment_pct: 40, installment_count: 2 },
    });
    expect(signed.response.status).toBe(200);
    expect(signed.body.data).toMatchObject({
      shares: 5,
      total_price: 5_000_000,
      down_payment: 2_000_000,
      installment_count: 2,
    });
    const schedule = signed.body.data.schedule as Json[];
    expect(schedule).toHaveLength(3);
    expect(schedule.reduce((t, r) => t + (r.amount as number), 0)).toBe(5_000_000);
  });

  it('takes money, oldest installment first, and says what is left', async () => {
    const { body } = await hold();
    const id = body.data.id as string;
    await sign(id);

    const paid = await pay(id, { paid_on: day(0), amount: 2_000_000, method: 'bank_transfer' });
    expect(paid.response.status).toBe(200);
    expect(paid.body.data).toMatchObject({ paid: 2_000_000, outstanding: 8_000_000 });

    const schedule = paid.body.data.schedule as Json[];
    expect(schedule[0]).toMatchObject({ seq: 0, status: 'paid', remaining: 0 });
    expect(schedule[1]).toMatchObject({ seq: 1, paid_amount: 0 });

    const receipts = paid.body.data.payments as Json[];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      code: `SRC-${new Date().getUTCFullYear()}-0001`,
      amount: 2_000_000,
      late_fee: 0,
    });

    // and the money is split across rows when it is more than one owes
    const second = await pay(id, { paid_on: day(0), amount: 3_000_000, method: 'cash' });
    const after = second.body.data.schedule as Json[];
    expect(after[1]).toMatchObject({ seq: 1, status: 'paid' });
    expect(after[2]).toMatchObject({ seq: 2, paid_amount: 1_000_000 });
  });

  it('charges the late fee first, as of the day the money arrived', async () => {
    // held and signed two months ago, so installment 1 is long overdue
    const { body } = await hold({ reserved_on: day(-60) });
    const id = body.data.id as string;
    const signed = await sign(id, { agreement_date: day(-60), first_due_date: day(-30) });
    expect(signed.response.status).toBe(200);

    const read = await getSale(req('GET', `/api/v1/share-sales/${id}`, { token }), ctx(id));
    const view = (await read.json()) as { data: Json };
    // the down payment is exempt; installment 1 is 2% of 2,000,000 past 7 days
    expect(view.data.late_fees).toBe(40_000);
    expect(view.data.health).toBe('overdue');
    expect(view.data.due_now).toBe(4_040_000);

    /*
     * The down payment is older than the overdue installment, so money goes
     * there first — oldest row first is the rule, and it carries no late fee.
     */
    const first = await pay(id, { paid_on: day(0), amount: 2_000_000, method: 'cash' });
    expect((first.body.data.payments as Json[])[0]).toMatchObject({ late_fee: 0 });

    /* now the oldest unpaid row is the overdue one, and its fee is taken first */
    const paid = await pay(id, { paid_on: day(0), amount: 100_000, method: 'cash' });
    const receipts = paid.body.data.payments as Json[];
    expect(receipts[0]).toMatchObject({ late_fee: 40_000, principal: 60_000, amount: 100_000 });
  });

  it('refuses more money than is owed, and a date before the agreement', async () => {
    const { body } = await hold();
    const id = body.data.id as string;
    await sign(id);

    const tooMuch = await pay(id, { paid_on: day(0), amount: 20_000_000, method: 'cash' });
    expect(tooMuch.response.status).toBe(422);
    expect((tooMuch.body.error as { fields: Json }).fields).toHaveProperty('amount');

    const tooEarly = await pay(id, { paid_on: day(-5), amount: 1000, method: 'cash' });
    expect(tooEarly.response.status).toBe(422);

    const future = await pay(id, { paid_on: day(2), amount: 1000, method: 'cash' });
    expect(future.response.status).toBe(422);
  });

  it('marks the purchase paid off when the last taka arrives', async () => {
    const { body } = await hold({ down_payment_pct: 100, installment_count: 0 });
    const id = body.data.id as string;
    await sign(id);

    const paid = await pay(id, { paid_on: day(0), amount: 10_000_000, method: 'bank_transfer' });
    expect(paid.body.data).toMatchObject({ status: 'fully_paid', outstanding: 0, health: 'fully_paid' });
  });

  it('corrects a receipt by its opposite, never by changing it', async () => {
    const { body } = await hold({ down_payment_pct: 100, installment_count: 0 });
    const id = body.data.id as string;
    await sign(id);
    const paid = await pay(id, { paid_on: day(0), amount: 10_000_000, method: 'cash' });
    const receipt = (paid.body.data.payments as Json[])[0]!;

    const reversed = await reversePayment(
      req('PATCH', `/api/v1/share-sales/${id}/payments`, {
        body: { payment_id: receipt.id, reason: 'Recorded against the wrong purchase' },
        token,
      }),
      ctx(id),
    );
    expect(reversed.status).toBe(200);
    const after = (await reversed.json()) as { data: Json };

    // both receipts are on the file, and they net to nothing
    const receipts = after.data.payments as Json[];
    expect(receipts).toHaveLength(2);
    expect(receipts.reduce((t, r) => t + (r.amount as number), 0)).toBe(0);
    expect(after.data).toMatchObject({ paid: 0, outstanding: 10_000_000, status: 'agreement_signed' });

    // and the original is still exactly as it was written
    const original = await db.sharePayment.findFirstOrThrow({ where: { id: receipt.id as string } });
    expect(original.amount.toNumber()).toBe(10_000_000);

    // a reversal is not itself reversible
    const again = await reversePayment(
      req('PATCH', `/api/v1/share-sales/${id}/payments`, {
        body: { payment_id: receipt.id, reason: 'Again' },
        token,
      }),
      ctx(id),
    );
    expect(again.status).toBe(409);
  });

  it('releases a hold and cancels a signed purchase, each with its own right', async () => {
    const first = await hold();
    const firstId = first.body.data.id as string;

    const released = await patchStatus(
      req('PATCH', `/api/v1/share-sales/${firstId}/status`, {
        body: { status: 'released', note: 'Customer changed their mind' },
        token,
      }),
      ctx(firstId),
    );
    expect(released.status).toBe(200);
    expect(((await released.json()) as { data: Json }).data.status).toBe('released');

    // the shares went back: the round has all 500 again
    const second = await hold();
    const secondId = second.body.data.id as string;
    await sign(secondId);

    // cancelling needs a reason
    const noReason = await patchStatus(
      req('PATCH', `/api/v1/share-sales/${secondId}/status`, {
        body: { status: 'cancelled', note: '' },
        token,
      }),
      ctx(secondId),
    );
    expect(noReason.status).toBe(422);

    const cancelled = await patchStatus(
      req('PATCH', `/api/v1/share-sales/${secondId}/status`, {
        body: { status: 'cancelled', note: 'Defaulted after three reminders' },
        token,
      }),
      ctx(secondId),
    );
    expect(cancelled.status).toBe(200);
  });

  it('lets the sales desk sign, but not say that money arrived', async () => {
    const { body } = await hold({}, salesToken);
    const id = body.data.id as string;

    const signed = await sign(id, {}, salesToken);
    expect(signed.response.status).toBe(200);

    const paid = await pay(id, { paid_on: day(0), amount: 1000, method: 'cash' }, salesToken);
    expect(paid.response.status).toBe(403);
  });

  it('audits the purchase, the agreement and the receipt', async () => {
    const { body } = await hold();
    const id = body.data.id as string;
    await sign(id);
    await pay(id, { paid_on: day(0), amount: 2_000_000, method: 'cash' });

    const sales = await db.auditLog.findMany({
      where: { table_name: 'share_sales' },
      orderBy: { at: 'asc' },
    });
    expect(sales.map((r: { action: string }) => r.action)).toEqual(['create', 'update']);
    expect(sales[0]!.record_code).toBe(`SHR-${new Date().getUTCFullYear()}-001`);

    const receipts = await db.auditLog.findMany({ where: { table_name: 'share_payments' } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.action).toBe('create');
  });
});
