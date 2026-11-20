import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as getPolicy, PUT as putPolicy } from '@/app/api/v1/projects/[id]/revenue/route';
import {
  GET as listEntries,
  POST as createEntry,
} from '@/app/api/v1/projects/[id]/revenue/entries/route';
import {
  GET as listPeriods,
  POST as closePeriod,
} from '@/app/api/v1/projects/[id]/revenue/periods/route';
import {
  GET as listAllocations,
  PATCH as movePeriod,
} from '@/app/api/v1/revenue-periods/[id]/route';
import { GET as getEarnings } from '@/app/api/v1/customers/[id]/earnings/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * What the project earns, and who gets what of it.
 *
 * The worked example in REVENUE-SHARE-PLAN.md is the spine of these tests: a
 * quarter's income and cost become a statement, management declares part of
 * what is available, and every holder's share is frozen on a record date. The
 * figures must add back up to the declared amount — that is the one thing an
 * investor will check.
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

/* a quarter that is safely in the past, whatever today is */
const YEAR = new Date().getUTCFullYear() - 1;
const Q1 = { start: `${YEAR}-01-01`, end: `${YEAR}-03-31` };
const Q2 = { start: `${YEAR}-04-01`, end: `${YEAR}-06-30` };

suite('revenue and profit sharing API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let viewerToken: string;
  let projectId: string;
  let offeringId: string;

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
          ],
        },
      },
    });
    await db.role.create({
      data: {
        code: 'accounts_clerk',
        name: 'Accounts clerk',
        permissions: {
          create: [
            { module: 'share_sale', level: 'view' },
            { module: 'finance_collection', level: 'create' },
          ],
        },
      },
    });
    await db.user.create({
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: {
        name: 'Clerk',
        phone: '01711000002',
        password_hash: hash,
        role_code: 'accounts_clerk',
      },
    });
    token = await signIn('01711000001');
    viewerToken = await signIn('01711000002');
    seq = 0;

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
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function setPolicy(body: Json = {}, as = token) {
    const response = await putPolicy(
      req('PUT', `/api/v1/projects/${projectId}/revenue`, {
        body: {
          distribution_frequency: 'quarterly',
          first_period_start: Q1.start,
          reserve_pct: 10,
          tax_withholding_pct: 10,
          eligibility_rule: 'all_signed',
          prorate_days: false,
          ...body,
        },
        token: as,
      }),
      ctx(projectId),
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  async function entry(body: Json, as = token) {
    const response = await createEntry(
      req('POST', `/api/v1/projects/${projectId}/revenue/entries`, { body, token: as }),
      ctx(projectId),
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  async function periods(as = token) {
    const response = await listPeriods(
      req('GET', `/api/v1/projects/${projectId}/revenue/periods`, { token: as }),
      ctx(projectId),
    );
    return (await response.json()) as {
      data: { policy: Json | null; closed: Json[]; open: Json[] };
    };
  }

  async function close(start: string) {
    const response = await closePeriod(
      req('POST', `/api/v1/projects/${projectId}/revenue/periods`, {
        body: { period_start: start },
        token,
      }),
      ctx(projectId),
    );
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  async function move(periodId: string, body: Json, as = token) {
    const response = await movePeriod(
      req('PATCH', `/api/v1/revenue-periods/${periodId}`, { body, token: as }),
      ctx(periodId),
    );
    return {
      response,
      body: response.status === 204 ? null : ((await response.json()) as { data: Json; error?: Json }),
    };
  }

  let seq = 0;

  /** A signed purchase of `shares`, paid `paid`, as of the start of the year. */
  async function holding(name: string, phone: string, shares: number, paid: number) {
    const n = String(++seq).padStart(3, '0');
    const customer = await db.customer.create({
      data: { code: `CUST-${YEAR}-${n}`, name, phone },
    });
    const sale = await db.shareSale.create({
      data: {
        code: `SHR-${YEAR}-${n}`,
        offering_id: offeringId,
        project_id: projectId,
        customer_id: customer.id,
        shares,
        share_pct: (shares * 0.1).toFixed(6),
        price_per_share: '1000000.00',
        total_price: `${shares * 1_000_000}.00`,
        down_payment: '0.00',
        installment_count: 0,
        reserved_on: new Date(`${YEAR}-01-01T00:00:00Z`),
        hold_until: new Date(`${YEAR}-01-08T00:00:00Z`),
        agreement_no: `AGR-${YEAR}-${n}`,
        agreement_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        status: 'agreement_signed',
      },
    });
    if (paid > 0) {
      await db.sharePayment.create({
        data: {
          code: `SRC-${YEAR}-${n}`,
          sale_id: sale.id,
          paid_on: new Date(`${YEAR}-01-05T00:00:00Z`),
          amount: `${paid}.00`,
          principal: `${paid}.00`,
          method: 'bank_transfer',
        },
      });
    }
    return { customer, sale };
  }

  it('turns profit sharing on, and will not take a statement figure from a caller', async () => {
    const { response, body } = await setPolicy();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      distribution_frequency: 'quarterly',
      first_period_start: Q1.start,
      reserve_pct: 10,
      loss_rule: 'recover_first',
    });

    const read = await getPolicy(
      req('GET', `/api/v1/projects/${projectId}/revenue`, { token }),
      ctx(projectId),
    );
    expect(((await read.json()) as { data: { policy: Json } }).data.policy).toMatchObject({
      project_id: projectId,
    });

    // a project with no policy has no profit sharing, and says so plainly
    const other = await db.project.create({ data: { code: 'PRJ-2026-009', name: 'Quiet Plot' } });
    const none = await getPolicy(
      req('GET', `/api/v1/projects/${other.id}/revenue`, { token }),
      ctx(other.id),
    );
    expect(((await none.json()) as { data: { policy: Json | null } }).data.policy).toBeNull();
  });

  it('refuses an entry before there is a policy, or outside what the project earns', async () => {
    const early = await entry({
      entry_date: `${YEAR}-02-01`,
      direction: 'income',
      head: 'Room rent',
      amount: 1000,
    });
    expect(early.response.status).toBe(409);

    await setPolicy();

    const beforeStart = await entry({
      entry_date: `${YEAR - 1}-12-31`,
      direction: 'income',
      head: 'Room rent',
      amount: 1000,
    });
    expect(beforeStart.response.status).toBe(422);

    const future = await entry({
      entry_date: `${new Date().getUTCFullYear() + 1}-01-01`,
      direction: 'income',
      head: 'Room rent',
      amount: 1000,
    });
    expect(future.response.status).toBe(422);
  });

  it('works the statement out from the entries, in the plan’s order', async () => {
    await setPolicy();
    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 5_000_000 });
    await entry({ entry_date: `${YEAR}-02-15`, direction: 'cost', head: 'Salary & wages', amount: 3_200_000 });

    const open = (await periods()).data.open.find((p) => p.period_start === Q1.start)!;
    expect(open).toMatchObject({
      label: `Q1 ${YEAR}`,
      income: 5_000_000,
      cost: 3_200_000,
      operating_profit: 1_800_000,
      // 10% of the profit is kept back, so 16.2 lakh can be shared
      reserve: 180_000,
      available: 1_620_000,
      closable: true,
    });
  });

  it('closes a period, locks its entries, and can open it again until it is approved', async () => {
    await setPolicy();
    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 1_000_000 });

    const closed = await close(Q1.start);
    expect(closed.response.status).toBe(201);
    const periodId = closed.body.data.id as string;
    expect(closed.body.data).toMatchObject({ status: 'closed', income: 1_000_000 });

    // the entry now belongs to that period, and is locked
    const entries = await listEntries(
      req('GET', `/api/v1/projects/${projectId}/revenue/entries`, { token }),
      ctx(projectId),
    );
    const rows = ((await entries.json()) as { data: Json[] }).data;
    expect(rows[0]).toMatchObject({ period_id: periodId, locked: true });

    // and no new entry may fall inside it
    const late = await entry({
      entry_date: `${YEAR}-03-01`,
      direction: 'cost',
      head: 'Utilities',
      amount: 500,
    });
    expect(late.response.status).toBe(409);
    expect(String((late.body.error as Json).message)).toMatch(/has been closed/);

    // closing it twice is refused
    expect((await close(Q1.start)).response.status).toBe(409);

    // reopening gives the entries back
    const reopened = await move(periodId, { action: 'reopen' });
    expect(reopened.response.status).toBe(204);
    const after = await listEntries(
      req('GET', `/api/v1/projects/${projectId}/revenue/entries`, { token }),
      ctx(projectId),
    );
    expect(((await after.json()) as { data: Json[] }).data[0]).toMatchObject({ locked: false });
  });

  it('will not close a period that has not ended', async () => {
    await setPolicy({ first_period_start: `${new Date().getUTCFullYear()}-01-01` });
    const open = (await periods()).data.open;
    const current = open[open.length - 1]!;
    const refused = await close(current.period_start as string);
    expect(refused.response.status).toBe(409);
  });

  it('carries a loss forward, and shares nothing until it is covered', async () => {
    await setPolicy();
    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 1_000_000 });
    await entry({ entry_date: `${YEAR}-02-15`, direction: 'cost', head: 'Salary & wages', amount: 1_500_000 });

    const q1 = await close(Q1.start);
    expect(q1.body.data).toMatchObject({
      operating_profit: -500_000,
      available: 0,
      loss_carried_out: 500_000,
    });

    await entry({ entry_date: `${YEAR}-05-15`, direction: 'income', head: 'Room rent', amount: 2_000_000 });
    await entry({ entry_date: `${YEAR}-05-20`, direction: 'cost', head: 'Utilities', amount: 500_000 });

    const q2 = await close(Q2.start);
    // 15 lakh profit, less the 5 lakh carried in, less 10% reserve of what is left
    expect(q2.body.data).toMatchObject({
      operating_profit: 1_500_000,
      loss_brought_in: 500_000,
      reserve: 100_000,
      available: 900_000,
    });
  });

  it('declares a period and freezes every holder’s share, adding back up to it', async () => {
    await setPolicy();
    const rahim = await holding('Rahim Uddin', '01711223344', 100, 100_000_000);
    const karim = await holding('Karim Mia', '01811223344', 150, 150_000_000);

    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 5_000_000 });
    await entry({ entry_date: `${YEAR}-02-15`, direction: 'cost', head: 'Salary & wages', amount: 3_200_000 });

    const closed = await close(Q1.start);
    const periodId = closed.body.data.id as string;

    // a period cannot be declared before its statement is approved
    expect((await move(periodId, { action: 'declare' })).response.status).toBe(409);

    // management may keep part of it back
    const approved = await move(periodId, { action: 'approve', declared: 1_000_000 });
    expect(approved.response.status).toBe(200);
    expect(approved.body!.data).toMatchObject({ status: 'approved', declared: 1_000_000 });

    // but never more than the statement allows
    const closed2 = await move(periodId, { action: 'approve', declared: 9_000_000 });
    expect(closed2.response.status).toBe(409);

    const declared = await move(periodId, { action: 'declare' });
    expect(declared.response.status).toBe(200);
    const result = declared.body!.data as { period: Json; allocations: Json[] };
    expect(result.period).toMatchObject({ status: 'declared', record_date: Q1.end });

    const lines = result.allocations;
    // two customers and the owners' line
    expect(lines).toHaveLength(3);

    const byCustomer = new Map(lines.filter((l) => l.customer_id).map((l) => [l.customer_id, l]));
    // 100 shares of 0.1% each is 10% of the project, of ৳10,00,000
    expect(byCustomer.get(rahim.customer.id)).toMatchObject({
      ownership_pct: 10,
      gross: 100_000,
      tax_withheld: 10_000,
      net_credited: 90_000,
    });
    expect(byCustomer.get(karim.customer.id)).toMatchObject({ ownership_pct: 15, gross: 150_000 });

    // the owners keep the 75% nobody bought
    const owners = lines.find((l) => l.holder_type === 'partner')!;
    expect(owners).toMatchObject({ ownership_pct: 75, gross: 750_000 });

    // and the lines add back up to exactly what was declared
    expect(lines.reduce((t, l) => t + (l.gross as number), 0)).toBe(1_000_000);

    // declaring twice is refused
    expect((await move(periodId, { action: 'declare' })).response.status).toBe(409);
    // and it can no longer be reopened
    expect((await move(periodId, { action: 'reopen' })).response.status).toBe(409);
  });

  it('gives an unpaid holder less, and the rest to the owners', async () => {
    await setPolicy({ eligibility_rule: 'pro_rata_paid' });
    const halfPaid = await holding('Rahim Uddin', '01711223344', 100, 50_000_000);

    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 2_000_000 });
    const closed = await close(Q1.start);
    const periodId = closed.body.data.id as string;
    await move(periodId, { action: 'approve', declared: 1_000_000 });
    const declared = await move(periodId, { action: 'declare' });

    const lines = (declared.body!.data as { allocations: Json[] }).allocations;
    const theirs = lines.find((l) => l.customer_id === halfPaid.customer.id)!;
    // they hold 10% but have paid half the price, so they take half of it
    expect(theirs).toMatchObject({ ownership_pct: 10, eligibility_factor: 0.5, gross: 50_000 });

    const owners = lines.find((l) => l.holder_type === 'partner')!;
    // the owners carried the unpaid part, so it comes back to them
    expect(owners.gross).toBe(950_000);
    expect(lines.reduce((t, l) => t + (l.gross as number), 0)).toBe(1_000_000);
  });

  it('tells an investor what they have earned, across periods', async () => {
    await setPolicy();
    const rahim = await holding('Rahim Uddin', '01711223344', 100, 100_000_000);
    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 2_000_000 });

    const closed = await close(Q1.start);
    const periodId = closed.body.data.id as string;
    await move(periodId, { action: 'approve', declared: 1_000_000 });
    await move(periodId, { action: 'declare' });

    const response = await getEarnings(
      req('GET', `/api/v1/customers/${rahim.customer.id}/earnings`, { token }),
      ctx(rahim.customer.id),
    );
    const earnings = (await response.json()) as {
      data: { lines: Json[]; totals: Json };
    };
    expect(earnings.data.lines).toHaveLength(1);
    expect(earnings.data.lines[0]).toMatchObject({
      project_name: 'Grand Palace Resort',
      period_label: `Q1 ${YEAR}`,
      gross: 100_000,
      net_credited: 90_000,
    });
    expect(earnings.data.totals).toMatchObject({ gross: 100_000, tax_withheld: 10_000, credited: 90_000 });
  });

  it('keeps the desks apart: a clerk records, management declares', async () => {
    await setPolicy();
    // the clerk may write an entry
    const written = await entry(
      { entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 1000 },
      viewerToken,
    );
    expect(written.response.status).toBe(201);

    // but not set the rules the shares are worked out from
    expect((await setPolicy({}, viewerToken)).response.status).toBe(403);

    const closed = await close(Q1.start);
    const periodId = closed.body.data.id as string;
    const approved = await move(periodId, { action: 'approve', declared: 100 }, viewerToken);
    expect(approved.response.status).toBe(403);
  });

  it('audits the policy, the entry, the period and every allocation', async () => {
    await setPolicy();
    await entry({ entry_date: `${YEAR}-01-15`, direction: 'income', head: 'Room rent', amount: 2_000_000 });
    await holding('Rahim Uddin', '01711223344', 100, 100_000_000);
    const closed = await close(Q1.start);
    const periodId = closed.body.data.id as string;
    await move(periodId, { action: 'approve', declared: 1_000_000 });
    await move(periodId, { action: 'declare' });

    for (const table of ['revenue_policies', 'revenue_entries', 'revenue_periods', 'profit_allocations']) {
      const rows = await db.auditLog.findMany({ where: { table_name: table } });
      expect(rows.length, table).toBeGreaterThan(0);
    }

    const allocations = await listAllocations(
      req('GET', `/api/v1/revenue-periods/${periodId}`, { token }),
      ctx(periodId),
    );
    expect(((await allocations.json()) as { data: Json[] }).data).toHaveLength(2);
  });
});
