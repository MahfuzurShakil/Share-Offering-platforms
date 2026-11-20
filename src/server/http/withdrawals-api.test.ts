import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { PUT as putPolicy } from '@/app/api/v1/projects/[id]/revenue/route';
import { POST as createEntry } from '@/app/api/v1/projects/[id]/revenue/entries/route';
import { POST as closePeriod } from '@/app/api/v1/projects/[id]/revenue/periods/route';
import { PATCH as movePeriod } from '@/app/api/v1/revenue-periods/[id]/route';
import { GET as listPeriodsAll } from '@/app/api/v1/revenue-periods/route';
import {
  GET as listWithdrawals,
  POST as requestWithdrawal,
} from '@/app/api/v1/profit-withdrawals/route';
import { PATCH as moveWithdrawal } from '@/app/api/v1/profit-withdrawals/[id]/route';
import { GET as getSale } from '@/app/api/v1/share-sales/[id]/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The last step of the story: an investor's profit becomes money in their
 * hand — or pays the installment they are behind on.
 *
 * The balance is never stored, so most of these are about it being the same
 * number however it is reached: credited, less paid out, less what is already
 * being asked for.
 */

const suite = hasTestDb ? describe : describe.skip;
type Json = Record<string, unknown>;

function req(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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
const todayStr = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

const YEAR = new Date().getUTCFullYear() - 1;
const Q1 = { start: `${YEAR}-01-01`, end: `${YEAR}-03-31` };

suite('profit withdrawals API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let clerkToken: string;
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
            { module: 'finance_expense', level: 'full' },
          ],
        },
      },
    });
    /* may record a request, but not decide on it or pay it */
    await db.role.create({
      data: {
        code: 'clerk',
        name: 'Clerk',
        permissions: {
          create: [
            { module: 'share_sale', level: 'view' },
            { module: 'finance_expense', level: 'create' },
          ],
        },
      },
    });
    await db.user.create({
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Clerk', phone: '01711000002', password_hash: hash, role_code: 'clerk' },
    });
    token = await signIn('01711000001');
    clerkToken = await signIn('01711000002');

    const project = await db.project.create({
      data: {
        code: 'PRJ-2026-001',
        name: 'Grand Palace Resort',
        sales_status: 'open',
        valuation: '1000000000.00',
        total_shares: 1000,
        valuation_date: new Date(`${YEAR}-01-01T00:00:00Z`),
      },
    });
    projectId = project.id;

    const offering = await db.shareOffering.create({
      data: {
        code: 'OFR-2026-001',
        project_id: projectId,
        round_no: 1,
        net_asset_value: '1000000000.00',
        valuation: '1000000000.00',
        valuation_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        offered_pct: '25.000000',
        total_shares: 250,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        status: 'open',
      },
    });
    offeringId = offering.id;

    const customer = await db.customer.create({
      data: { code: 'CUST-2026-001', name: 'Rahim Uddin', phone: '01711223344' },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /** A signed purchase of 100 shares (10% of the project), paid in full. */
  async function fullyPaidHolding() {
    const sale = await db.shareSale.create({
      data: {
        code: 'SHR-2026-001',
        offering_id: offeringId,
        project_id: projectId,
        customer_id: customerId,
        shares: 100,
        share_pct: '10.000000',
        price_per_share: '1000000.00',
        total_price: '100000000.00',
        down_payment: '100000000.00',
        installment_count: 0,
        reserved_on: new Date(`${YEAR}-01-01T00:00:00Z`),
        hold_until: new Date(`${YEAR}-01-08T00:00:00Z`),
        agreement_no: 'AGR-2026-001',
        agreement_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        status: 'agreement_signed',
      },
    });
    const installment = await db.shareInstallment.create({
      data: {
        sale_id: sale.id,
        seq: 0,
        due_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        amount: '100000000.00',
      },
    });
    /*
     * With its allocation, as every real receipt has one: the schedule is read
     * through the allocations, so a payment without them pays nothing.
     * `SRC-0000-…` keeps the fixture out of the live series' way.
     */
    await db.sharePayment.create({
      data: {
        code: 'SRC-0000-0001',
        sale_id: sale.id,
        paid_on: new Date(`${YEAR}-01-02T00:00:00Z`),
        amount: '100000000.00',
        principal: '100000000.00',
        method: 'bank_transfer',
        allocations: {
          create: [{ installment_id: installment.id, principal: '100000000.00' }],
        },
      },
    });
    return sale;
  }

  /** A purchase with an overdue installment and nothing paid on it. */
  async function overdueHolding() {
    const sale = await db.shareSale.create({
      data: {
        code: 'SHR-2026-002',
        offering_id: offeringId,
        project_id: projectId,
        customer_id: customerId,
        shares: 100,
        share_pct: '10.000000',
        price_per_share: '1000000.00',
        total_price: '100000000.00',
        down_payment: '0.00',
        installment_count: 1,
        reserved_on: new Date(`${YEAR}-01-01T00:00:00Z`),
        hold_until: new Date(`${YEAR}-01-08T00:00:00Z`),
        agreement_no: 'AGR-2026-002',
        agreement_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        first_due_date: new Date(`${YEAR}-02-01T00:00:00Z`),
        status: 'agreement_signed',
      },
    });
    await db.shareInstallment.createMany({
      data: [
        { sale_id: sale.id, seq: 0, due_date: new Date(`${YEAR}-01-01T00:00:00Z`), amount: '0.00' },
        {
          sale_id: sale.id,
          seq: 1,
          due_date: new Date(`${YEAR}-02-01T00:00:00Z`),
          amount: '100000000.00',
        },
      ],
    });
    return sale;
  }

  async function declareQuarter(opts: { declared: number; adjust?: boolean }) {
    await putPolicy(
      req('PUT', `/api/v1/projects/${projectId}/revenue`, {
        body: {
          distribution_frequency: 'quarterly',
          first_period_start: Q1.start,
          reserve_pct: 0,
          tax_withholding_pct: 10,
          eligibility_rule: 'all_signed',
          prorate_days: false,
          min_withdrawal: 5000,
          adjust_overdue_first: opts.adjust ?? false,
        },
        token,
      }),
      ctx(projectId),
    );
    await createEntry(
      req('POST', `/api/v1/projects/${projectId}/revenue/entries`, {
        body: {
          entry_date: `${YEAR}-01-15`,
          direction: 'income',
          head: 'Room rent',
          amount: opts.declared * 2,
        },
        token,
      }),
      ctx(projectId),
    );
    const closed = await closePeriod(
      req('POST', `/api/v1/projects/${projectId}/revenue/periods`, {
        body: { period_start: Q1.start },
        token,
      }),
      ctx(projectId),
    );
    const periodId = ((await closed.json()) as { data: Json }).data.id as string;
    await movePeriod(
      req('PATCH', `/api/v1/revenue-periods/${periodId}`, {
        body: { action: 'approve', declared: opts.declared },
        token,
      }),
      ctx(periodId),
    );
    const declared = await movePeriod(
      req('PATCH', `/api/v1/revenue-periods/${periodId}`, { body: { action: 'declare' }, token }),
      ctx(periodId),
    );
    return (await declared.json()) as { data: { period: Json; allocations: Json[] } };
  }

  async function balances(as = token) {
    const response = await listWithdrawals(
      req('GET', `/api/v1/profit-withdrawals?balances_for=${customerId}`, { token: as }),
      undefined,
    );
    return ((await response.json()) as { data: { balances: Json[] } }).data.balances;
  }

  async function ask(amount: number, as = token) {
    const response = await requestWithdrawal(
      req('POST', '/api/v1/profit-withdrawals', {
        body: {
          project_id: projectId,
          customer_id: customerId,
          amount,
          method: 'bank_transfer',
          pay_to: 'BRAC Bank · 1501203456789',
        },
        token: as,
      }),
      undefined,
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  async function move(id: string, body: Json, as = token) {
    const response = await moveWithdrawal(
      req('PATCH', `/api/v1/profit-withdrawals/${id}`, { body, token: as }),
      ctx(id),
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  it('says what an investor has, and holds it the moment they ask', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });

    // 10% of ৳10,00,000, less 10% tax
    expect(await balances()).toMatchObject([
      { project_name: 'Grand Palace Resort', credited: 90_000, paid_out: 0, pending: 0, available: 90_000 },
    ]);

    const asked = await ask(50_000);
    expect(asked.response.status).toBe(201);
    expect(asked.body.data).toMatchObject({
      code: `WDR-${new Date().getUTCFullYear()}-001`,
      status: 'requested',
      amount: 50_000,
      customer_name: 'Rahim Uddin',
    });

    // the money is held while it is being looked at
    expect(await balances()).toMatchObject([{ credited: 90_000, pending: 50_000, available: 40_000 }]);

    // so the same taka cannot be asked for twice
    const again = await ask(50_000);
    expect(again.response.status).toBe(422);
    expect((again.body.error as { fields: Json }).fields).toHaveProperty('amount');
  });

  it('refuses less than the minimum the project sets', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });

    const tooLittle = await ask(1000);
    expect(tooLittle.response.status).toBe(409);
    expect(String((tooLittle.body.error as Json).message)).toMatch(/minimum/i);
  });

  it('approves, pays, and takes the money out of the balance for good', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });
    const asked = await ask(50_000);
    const id = asked.body.data.id as string;

    // paying before it is approved is refused
    expect((await move(id, { action: 'pay', paid_on: todayStr() })).response.status).toBe(409);

    const approved = await move(id, { action: 'approve' });
    expect(approved.response.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    // approving does not release it: it is still held
    expect(await balances()).toMatchObject([{ pending: 50_000, available: 40_000 }]);

    const paid = await move(id, {
      action: 'pay',
      paid_on: todayStr(),
      reference_no: 'TRX-9912',
    });
    expect(paid.response.status).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'paid', reference_no: 'TRX-9912' });

    expect(await balances()).toMatchObject([
      { credited: 90_000, paid_out: 50_000, pending: 0, available: 40_000 },
    ]);

    // and a paid one cannot be refused afterwards
    expect((await move(id, { action: 'reject', reason: 'Changed my mind' })).response.status).toBe(409);
  });

  it('gives a refused request its money back', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });
    const asked = await ask(90_000);
    const id = asked.body.data.id as string;

    const rejected = await move(id, { action: 'reject', reason: 'Bank account not verified' });
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: 'rejected',
      reject_reason: 'Bank account not verified',
    });

    expect(await balances()).toMatchObject([{ pending: 0, available: 90_000 }]);

    // a reason is not optional
    const second = await ask(90_000);
    const refused = await move(second.body.data.id as string, { action: 'reject', reason: '' });
    expect(refused.response.status).toBe(422);
  });

  it('pays the holder’s own overdue installment out of their profit first', async () => {
    const sale = await overdueHolding();
    const result = await declareQuarter({ declared: 1_000_000, adjust: true });

    const mine = result.data.allocations.find((a) => a.customer_id === customerId)!;
    // the whole net share went onto what they owe, so nothing reaches the balance
    expect(mine).toMatchObject({ gross: 100_000, tax_withheld: 10_000, adjusted_to_dues: 90_000, net_credited: 0 });
    expect(await balances()).toMatchObject([{ credited: 0, available: 0 }]);

    // and it is a real payment on the purchase, marked as not being cash
    const read = await getSale(req('GET', `/api/v1/share-sales/${sale.id}`, { token }), ctx(sale.id));
    const view = (await read.json()) as { data: Json };
    expect(view.data.paid).toBeGreaterThan(0);
    const receipts = view.data.payments as Json[];
    expect(receipts[0]).toMatchObject({ method: 'profit_adjustment' });
  });

  it('leaves the balance alone when the holder owes nothing', async () => {
    await fullyPaidHolding();
    const result = await declareQuarter({ declared: 1_000_000, adjust: true });
    const mine = result.data.allocations.find((a) => a.customer_id === customerId)!;
    expect(mine).toMatchObject({ adjusted_to_dues: 0, net_credited: 90_000 });
  });

  it('keeps the desks apart: a clerk records the request, the money desk decides', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });

    const asked = await ask(50_000, clerkToken);
    expect(asked.response.status).toBe(201);

    const id = asked.body.data.id as string;
    expect((await move(id, { action: 'approve' }, clerkToken)).response.status).toBe(403);
  });

  it('lists the requests, and the periods behind them, across projects', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });
    await ask(50_000);

    const list = await listWithdrawals(
      req('GET', '/api/v1/profit-withdrawals?status=requested', { token }),
      undefined,
    );
    const rows = (await list.json()) as { data: Json[]; meta: Json };
    expect(rows.data).toHaveLength(1);
    expect(rows.data[0]).toMatchObject({ project_name: 'Grand Palace Resort', amount: 50_000 });

    const periods = await listPeriodsAll(
      req('GET', '/api/v1/revenue-periods?status=declared', { token }),
      undefined,
    );
    const periodRows = ((await periods.json()) as { data: Json[] }).data;
    expect(periodRows).toHaveLength(1);
    // the customer and the owners
    expect(periodRows[0]).toMatchObject({ project_name: 'Grand Palace Resort', holders: 2 });
  });

  it('audits the request and every decision on it', async () => {
    await fullyPaidHolding();
    await declareQuarter({ declared: 1_000_000 });
    const asked = await ask(50_000);
    const id = asked.body.data.id as string;
    await move(id, { action: 'approve' });
    await move(id, { action: 'pay', paid_on: todayStr() });

    const rows = await db.auditLog.findMany({
      where: { table_name: 'profit_withdrawals' },
      orderBy: { at: 'asc' },
    });
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['create', 'update', 'update']);
    expect(rows[0]!.record_code).toBe(`WDR-${new Date().getUTCFullYear()}-001`);
  });
});
