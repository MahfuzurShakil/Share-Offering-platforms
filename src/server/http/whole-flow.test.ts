import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as getCustomerEarnings } from '@/app/api/v1/customers/[id]/earnings/route';
import { PATCH as patchCustomer } from '@/app/api/v1/customers/[id]/route';
import { POST as convertLead } from '@/app/api/v1/leads/[id]/convert/route';
import { POST as completeStage } from '@/app/api/v1/leads/[id]/stage/route';
import { GET as getLead } from '@/app/api/v1/leads/[id]/route';
import { GET as getLeadQueue } from '@/app/api/v1/leads/queue/route';
import { POST as captureLead } from '@/app/api/v1/leads/route';
import { GET as getLeadSummary } from '@/app/api/v1/leads/summary/route';
import { PATCH as moveWithdrawal } from '@/app/api/v1/profit-withdrawals/[id]/route';
import { GET as listWithdrawals, POST as requestWithdrawal } from '@/app/api/v1/profit-withdrawals/route';
import { PATCH as patchProject } from '@/app/api/v1/projects/[id]/route';
import { PATCH as setSalesStatus } from '@/app/api/v1/projects/[id]/sales-status/route';
import { POST as addEntry } from '@/app/api/v1/projects/[id]/revenue/entries/route';
import { POST as closePeriod } from '@/app/api/v1/projects/[id]/revenue/periods/route';
import { PUT as setPolicy } from '@/app/api/v1/projects/[id]/revenue/route';
import { POST as createProject } from '@/app/api/v1/projects/route';
import { PATCH as movePeriod } from '@/app/api/v1/revenue-periods/[id]/route';
import { POST as openOffering } from '@/app/api/v1/share-offerings/[id]/open/route';
import { POST as createOffering } from '@/app/api/v1/share-offerings/route';
import { POST as payShareSale } from '@/app/api/v1/share-sales/[id]/payments/route';
import { POST as signShareSale } from '@/app/api/v1/share-sales/[id]/sign/route';
import { POST as reserveShares } from '@/app/api/v1/share-sales/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { PERMISSION_MODULES } from '@/lib/domain/permissions';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The whole story, once, through the API nothing else touches.
 *
 * Every other suite here proves one module against the database. This one
 * proves they are the *same* story: an inquiry arrives, it becomes an
 * investor, the investor buys into a round of a valued project, pays for it,
 * the project earns, a period is closed and declared, and the investor takes
 * their share out. Each step is the real route handler, signed in, so what
 * breaks a hand-over between two modules breaks here rather than in a browser.
 *
 * It runs in order and shares one database, which is why it is `beforeAll` and
 * not `beforeEach`: the point is the chain, not the steps.
 *
 * The worked example is the plan's own (PROJECT-SHARE-SALE-PLAN.md §4): a
 * hotel worth 100 crore, cut into 1,000 shares of 0.1% each, half of it
 * offered in the first round at 10 lakh a share.
 */

const suite = hasTestDb ? describe : describe.skip;

type Envelope<T> = {
  data: T;
  error?: { code: string; message: string; fields?: Record<string, string> };
};

function req(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
const YEAR = new Date().getUTCFullYear();

/** A quarter in the past, so a period can be closed and the money can be late. */
const Q = {
  start: `${YEAR - 1}-10-01`,
  end: `${YEAR - 1}-12-31`,
};

const CRORE = 10_000_000;
const LAKH = 100_000;

suite('the whole flow', () => {
  let db: TestDb;
  let token: string;

  /** What each step hands the next one. */
  const story: {
    projectId?: string;
    offeringId?: string;
    leadId?: string;
    customerId?: string;
    saleId?: string;
    periodId?: string;
    withdrawalId?: string;
  } = {};

  async function call<T>(
    // the handlers differ in whether they take route params, so this is loose
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: (request: NextRequest, context: any) => Promise<Response>,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    init: { body?: unknown; id?: string } = {},
  ): Promise<T> {
    const response = await fn(
      req(method, path, { body: init.body, token }),
      init.id === undefined ? undefined : ctx(init.id),
    );
    const envelope = (await response.json()) as Envelope<T>;
    if (response.status >= 400) {
      const fields = envelope.error?.fields;
      throw new Error(
        `${method} ${path} → ${response.status} ${envelope.error?.code}: ${envelope.error?.message}` +
          (fields ? ` ${JSON.stringify(fields)}` : ''),
      );
    }
    return envelope.data;
  }

  beforeAll(async () => {
    db = testDb();
    await resetDb(db);
    clearPermissionCache();

    /*
     * One role with everything, because this is not a test of who may do
     * what — `route-guards` and each module's own suite cover that. Here the
     * question is whether the steps fit together at all.
     */
    await db.role.create({
      data: {
        code: 'super_admin',
        name: 'Super Admin',
        permissions: {
          create: PERMISSION_MODULES.map((module) => ({ module, level: 'full' })),
        },
      },
    });
    await db.user.create({
      data: {
        name: 'Nasreen Akhter',
        phone: '01711000001',
        password_hash: await hashPassword('nokshi-green-2026'),
        role_code: 'super_admin',
      },
    });

    const response = await login(
      req('POST', '/api/v1/auth/login', {
        body: { identifier: '01711000001', password: 'nokshi-green-2026' },
      }),
      undefined,
    );
    expect(response.status).toBe(200);
    token = ((await response.json()) as Envelope<{ token: string }>).data.token;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /* -------------------------------------------------------------- *
   * 1. A project, and what it is worth
   * -------------------------------------------------------------- */

  it('1. opens a project and values it', async () => {
    const project = await call<{ id: string; code: string }>(
      createProject,
      'POST',
      '/api/v1/projects',
      {
        body: {
          name: 'Sea Pearl Hotel',
          project_type: 'commercial',
          income_type: 'operation',
          location_summary: 'Kolatoli, Cox’s Bazar',
          expected_hold_months: 60,
        },
      },
    );
    expect(project.code).toBe(`PRJ-${YEAR}-001`);
    story.projectId = project.id;

    const valued = await call<{ valuation: number; total_shares: number }>(
      patchProject,
      'PATCH',
      `/api/v1/projects/${project.id}`,
      {
        id: project.id,
        body: {
          valuation: 100 * CRORE,
          total_shares: 1000,
          valuation_date: `${YEAR - 1}-09-01`,
        },
      },
    );
    // one share is 0.1% of the hotel, and that has to mean the same in every round
    expect(valued.valuation).toBe(100 * CRORE);
    expect(valued.total_shares).toBe(1000);

    /*
     * Sales have to be opened before a round can be offered, which is the
     * project's own gate rather than the round's: the decision that this
     * project is on the market is taken once, not per round.
     */
    const selling = await call<{ sales_status: string }>(
      setSalesStatus,
      'PATCH',
      `/api/v1/projects/${project.id}/sales-status`,
      { id: project.id, body: { sales_status: 'open' } },
    );
    expect(selling.sales_status).toBe('open');
  });

  /* -------------------------------------------------------------- *
   * 2. A round of its shares, on the market
   * -------------------------------------------------------------- */

  it('2. offers half the project in a round and opens it', async () => {
    const offering = await call<{
      id: string;
      code: string;
      price_per_share: number;
      share_pct: number;
      status: string;
    }>(createOffering, 'POST', '/api/v1/share-offerings', {
      body: {
        project_id: story.projectId,
        total_shares: 500,
        max_shares: 50,
        min_shares: 1,
        validity_days: 120,
        min_down_payment_pct: 20,
        max_installments: 4,
        installment_frequency: 'quarterly',
        late_fee_pct: 2,
        grace_days: 7,
        hold_days: 7,
      },
    });

    expect(offering.code).toBe(`OFR-${YEAR}-001`);
    // 100 crore over 1,000 shares — the price comes from the project, not the caller
    expect(offering.price_per_share).toBe(10 * LAKH);
    expect(offering.share_pct).toBeCloseTo(0.1, 6);
    expect(offering.status).toBe('draft');
    story.offeringId = offering.id;

    const open = await call<{ status: string; opens_on: string }>(
      openOffering,
      'POST',
      `/api/v1/share-offerings/${offering.id}/open`,
      { id: offering.id, body: { opens_on: `${YEAR - 1}-09-15` } },
    );
    expect(open.status).toBe('open');
  });

  /* -------------------------------------------------------------- *
   * 3. An inquiry, worked, and turned into an investor
   * -------------------------------------------------------------- */

  it('3. takes the inquiry, works it, and opens the investor file from it', async () => {
    const { merged, lead } = await call<{ merged: boolean; lead: { id: string; code: string } }>(
      captureLead,
      'POST',
      '/api/v1/leads',
      {
        body: {
          name: 'Rahim Uddin',
          phone: '01811 22 33 44',
          email: 'rahim@example.test',
          source: 'website_form',
          interested_project_id: story.projectId,
          budget_range: '2 – 3 Crore',
          inquiry_message: 'How many shares are left in the hotel?',
        },
      },
    );
    expect(merged).toBe(false);
    expect(lead.code).toBe(`LED-${YEAR}-001`);
    story.leadId = lead.id;

    // the desk rings him, and the call puts him on the list for next week
    const contacted = await call<{ status: string; next_follow_up: string }>(
      completeStage,
      'POST',
      `/api/v1/leads/${lead.id}/stage`,
      {
        id: lead.id,
        body: {
          to: 'contacted',
          activity_type: 'call',
          event_date: `${YEAR - 1}-09-20`,
          title: 'Contact Made',
          details: { How: 'Phone call', 'Looking for': '20 shares' },
          notes: 'Wants the hotel round, will pay in quarters',
          next_follow_up_date: `${YEAR - 1}-09-27`,
          updates: { interested_project_id: story.projectId },
        },
      },
    );
    expect(contacted.status).toBe('contacted');
    expect(contacted.next_follow_up).toBe(`${YEAR - 1}-09-27`);

    // that date is in the past, so he is on the call queue
    const summary = await call<{ overdue: number; unassigned: number }>(
      getLeadSummary,
      'GET',
      '/api/v1/leads/summary',
    );
    expect(summary.overdue).toBe(1);

    const queue = await call<Array<{ lead: { code: string }; date: string }>>(
      getLeadQueue,
      'GET',
      '/api/v1/leads/queue',
    );
    expect(queue.map((row) => row.lead.code)).toEqual([`LED-${YEAR}-001`]);

    const { existing, customer } = await call<{
      existing: boolean;
      customer: { id: string; code: string; phone: string };
    }>(convertLead, 'POST', `/api/v1/leads/${lead.id}/convert`, { id: lead.id, body: {} });

    expect(existing).toBe(false);
    expect(customer.code).toBe(`CUST-${YEAR}-001`);
    // the number came across in the one shape both tables keep it in
    expect(customer.phone).toBe('01811223344');
    story.customerId = customer.id;

    /*
     * The lead is still at `contacted`: an investor file is not a purchase,
     * and `booked` follows the purchase. This is the hand-over the two
     * modules used to disagree about.
     */
    const after = await call<{ status: string; customer: { code: string } | null }>(
      getLead,
      'GET',
      `/api/v1/leads/${lead.id}`,
      { id: lead.id },
    );
    expect(after.status).toBe('contacted');
    expect(after.customer?.code).toBe(`CUST-${YEAR}-001`);
  });

  /* -------------------------------------------------------------- *
   * 4. The purchase, from the hold to the last receipt
   * -------------------------------------------------------------- */

  it('4. reserves 20 shares, signs the schedule, and pays it off', async () => {
    const reserved = await call<{
      id: string;
      code: string;
      status: string;
      shares: number;
      total_price: number;
    }>(reserveShares, 'POST', '/api/v1/share-sales', {
      body: {
        offering_id: story.offeringId,
        customer_id: story.customerId,
        shares: 20,
        down_payment_pct: 20,
        installment_count: 4,
        reserved_on: `${YEAR - 1}-09-28`,
      },
    });

    expect(reserved.code).toBe(`SHR-${YEAR}-001`);
    expect(reserved.status).toBe('reserved');
    // 20 shares at 10 lakh — 2 crore, worked out from the round
    expect(reserved.total_price).toBe(2 * CRORE);
    story.saleId = reserved.id;

    /*
     * The agreement names a person, so it cannot be signed off a lead's name
     * and number alone: NID, father's or spouse's name and present address
     * have to be on the investor's record first. That is the one thing the
     * hand-over from the lead does *not* carry, and deliberately so — the
     * office takes those at the signing table, not off a website form
     * (PROJECT-SHARE-SALE-PLAN.md §4a).
     */
    await expect(
      call(signShareSale, 'POST', `/api/v1/share-sales/${reserved.id}/sign`, {
        id: reserved.id,
        body: { agreement_date: `${YEAR - 1}-09-30` },
      }),
    ).rejects.toThrow(/NID/);

    await call(patchCustomer, 'PATCH', `/api/v1/customers/${story.customerId}`, {
      id: story.customerId!,
      body: {
        nid: '1990123456789',
        father_or_spouse_name: 'Abdul Karim',
        address: 'House 14, Road 7, Dhanmondi, Dhaka',
        nominee_name: 'Ayesha Rahim',
        nominee_relation: 'Wife',
        bank_name: 'BRAC Bank',
        bank_account: '1501203456789',
      },
    });

    const signed = await call<{
      status: string;
      schedule: Array<{ seq: number; label: string; amount: number; due_date: string }>;
    }>(signShareSale, 'POST', `/api/v1/share-sales/${reserved.id}/sign`, {
      id: reserved.id,
      body: {
        agreement_date: `${YEAR - 1}-09-30`,
        first_due_date: `${YEAR - 1}-10-31`,
        signing: { place: 'Dhaka', company_signatory: 'Nasreen Akhter' },
      },
    });

    expect(signed.status).toBe('agreement_signed');
    // 20% down, then four quarterly rows of the remaining 1.6 crore
    const down = signed.schedule.find((row) => row.seq === 0);
    expect(down?.amount).toBe(40 * LAKH);
    expect(signed.schedule.filter((row) => row.seq > 0)).toHaveLength(4);
    expect(
      signed.schedule.reduce((sum, row) => sum + row.amount, 0),
    ).toBe(2 * CRORE);

    // the down payment, on the day it was signed
    const paid = await call<{ paid: number; outstanding: number; status: string }>(
      payShareSale,
      'POST',
      `/api/v1/share-sales/${reserved.id}/payments`,
      {
        id: reserved.id,
        body: {
          paid_on: `${YEAR - 1}-09-30`,
          amount: 40 * LAKH,
          method: 'bank_transfer',
          reference: 'BRAC/0098',
        },
      },
    );
    expect(paid.paid).toBe(40 * LAKH);
    expect(paid.outstanding).toBe(160 * LAKH);
    expect(paid.status).toBe('agreement_signed');

    /*
     * Then the rest of it, before the first installment falls due on 31 Oct,
     * so nothing is late and the whole payment goes to principal. The service
     * refuses a taka more than is owed, which is why the amount is read off
     * the purchase rather than written here.
     */
    const rest = await call<{ paid: number; outstanding: number; status: string; late_fees: number }>(
      payShareSale,
      'POST',
      `/api/v1/share-sales/${reserved.id}/payments`,
      {
        id: reserved.id,
        body: {
          paid_on: `${YEAR - 1}-10-15`,
          amount: paid.outstanding,
          method: 'bank_transfer',
          reference: 'BRAC/0131',
        },
      },
    );
    expect(rest.paid).toBe(2 * CRORE);
    expect(rest.outstanding).toBe(0);
    expect(rest.late_fees).toBe(0);
    expect(rest.status).toBe('fully_paid');
  });

  /* -------------------------------------------------------------- *
   * 5. What the project earned, and whose it is
   * -------------------------------------------------------------- */

  it('5. records the quarter’s income and cost, then closes the period', async () => {
    await call(setPolicy, 'PUT', `/api/v1/projects/${story.projectId}/revenue`, {
      id: story.projectId!,
      body: {
        entry_frequency: 'monthly',
        distribution_frequency: 'quarterly',
        first_period_start: Q.start,
        reserve_pct: 10,
        mgmt_fee_type: 'pct_profit',
        mgmt_fee_value: 5,
        loss_rule: 'recover_first',
        eligibility_rule: 'fully_paid',
        min_withdrawal: 1000,
        withdrawal_window: 'after_declare',
        adjust_overdue_first: true,
      },
    });

    for (const entry of [
      { entry_date: `${YEAR - 1}-10-31`, direction: 'income', head: 'Room revenue', amount: 90 * LAKH },
      { entry_date: `${YEAR - 1}-11-30`, direction: 'income', head: 'Room revenue', amount: 85 * LAKH },
      { entry_date: `${YEAR - 1}-12-31`, direction: 'income', head: 'Banquet', amount: 25 * LAKH },
      { entry_date: `${YEAR - 1}-11-15`, direction: 'cost', head: 'Staff salary', amount: 60 * LAKH },
      { entry_date: `${YEAR - 1}-12-20`, direction: 'cost', head: 'Utilities', amount: 20 * LAKH },
    ]) {
      await call(addEntry, 'POST', `/api/v1/projects/${story.projectId}/revenue/entries`, {
        id: story.projectId!,
        body: entry,
      });
    }

    const period = await call<{
      id: string;
      code: string;
      status: string;
      income: number;
      cost: number;
      operating_profit: number;
      reserve: number;
      mgmt_fee: number;
      available: number;
    }>(closePeriod, 'POST', `/api/v1/projects/${story.projectId}/revenue/periods`, {
      id: story.projectId!,
      body: { period_start: Q.start },
    });

    expect(period.status).toBe('closed');
    expect(period.income).toBe(200 * LAKH);
    expect(period.cost).toBe(80 * LAKH);
    expect(period.operating_profit).toBe(120 * LAKH);
    /*
     * 1.2 crore profit, less a 10% reserve and a 5% fee on the profit. The
     * service works these out from the policy; a caller who could send them
     * could declare a profit the project never made.
     */
    expect(period.reserve).toBe(12 * LAKH);
    expect(period.mgmt_fee).toBe(6 * LAKH);
    expect(period.available).toBe(120 * LAKH - 12 * LAKH - 6 * LAKH);
    story.periodId = period.id;
  });

  it('6. approves what will be shared, and declares it to the holders', async () => {
    const approved = await call<{ status: string; declared: number }>(
      movePeriod,
      'PATCH',
      `/api/v1/revenue-periods/${story.periodId}`,
      { id: story.periodId!, body: { action: 'approve', declared: 100 * LAKH } },
    );
    expect(approved.status).toBe('approved');
    expect(approved.declared).toBe(100 * LAKH);

    const { period, allocations } = await call<{
      period: { status: string; record_date: string | null };
      allocations: Array<{
        holder_type: string;
        customer_id: string | null;
        ownership_pct: number;
        gross: number;
        tax_withheld: number;
        net_credited: number;
      }>;
    }>(movePeriod, 'PATCH', `/api/v1/revenue-periods/${story.periodId}`, {
      id: story.periodId!,
      body: { action: 'declare', record_date: Q.end },
    });

    expect(period.status).toBe('declared');
    expect(period.record_date).toBe(Q.end);

    /*
     * He holds 20 of the project's 1,000 shares — 2% — so 2 lakh of the crore.
     * The other 98 lakh is the owners', because the rest of the project has
     * not been sold. The lines always add up to what was declared, which is
     * the rule the whole module exists to keep.
     */
    const his = allocations.find((row) => row.customer_id === story.customerId);
    expect(his?.gross).toBe(2 * LAKH);
    expect(his?.ownership_pct).toBeCloseTo(2, 6);
    expect(allocations.reduce((sum, row) => sum + row.gross, 0)).toBe(100 * LAKH);
    /*
     * The owners' side is one `partner` line until the Fund & Partners module
     * lands, at which point it becomes one line per partner and nothing else
     * about this changes (NEXT-SESSION.md, deliberately deferred).
     */
    expect(allocations.some((row) => row.holder_type === 'partner')).toBe(true);

    /*
     * 10% source tax is kept from each holder's share — the policy's default,
     * which this project did not override. So he is credited 1.8 lakh of the
     * 2 lakh that was his.
     */
    expect(his?.tax_withheld).toBe(20_000);
    expect(his?.net_credited).toBe(180_000);
  });

  /* -------------------------------------------------------------- *
   * 7. The investor takes it out
   * -------------------------------------------------------------- */

  it('7. shows him what he earned and pays part of it out', async () => {
    const earnings = await call<{
      lines: Array<{ project_id: string; net_credited: number }>;
      totals: { gross: number; credited: number };
    }>(getCustomerEarnings, 'GET', `/api/v1/customers/${story.customerId}/earnings`, {
      id: story.customerId!,
    });
    expect(earnings.totals.gross).toBe(2 * LAKH);
    expect(earnings.totals.credited).toBe(180_000);
    expect(earnings.lines).toHaveLength(1);
    expect(earnings.lines[0]?.project_id).toBe(story.projectId);

    const requested = await call<{
      id: string;
      code: string;
      status: string;
      amount: number;
      requested_on: string;
    }>(
      requestWithdrawal,
      'POST',
      '/api/v1/profit-withdrawals',
      {
        body: {
          project_id: story.projectId,
          customer_id: story.customerId,
          amount: 150_000,
          method: 'bank_transfer',
          pay_to: 'BRAC Bank 1501203456789',
        },
      },
    );
    expect(requested.code).toBe(`WDR-${YEAR}-001`);
    expect(requested.status).toBe('requested');
    story.withdrawalId = requested.id;

    // held from the balance from the moment it is asked for
    const held = await call<{
      balances: Array<{ credited: number; pending: number; available: number }>;
    }>(listWithdrawals, 'GET', `/api/v1/profit-withdrawals?balances_for=${story.customerId}`);
    expect(held.balances[0]?.credited).toBe(180_000);
    expect(held.balances[0]?.pending).toBe(150_000);
    expect(held.balances[0]?.available).toBe(30_000);

    await call(moveWithdrawal, 'PATCH', `/api/v1/profit-withdrawals/${story.withdrawalId}`, {
      id: story.withdrawalId!,
      body: { action: 'approve' },
    });
    const paid = await call<{ status: string; paid_on: string }>(
      moveWithdrawal,
      'PATCH',
      `/api/v1/profit-withdrawals/${story.withdrawalId}`,
      {
        id: story.withdrawalId!,
        /*
         * The day it was asked for, read off the request rather than written
         * here: money cannot be paid out before it was asked for, and a run
         * that crosses midnight would otherwise fail on a date of its own
         * making.
         */
        body: { action: 'pay', paid_on: requested.requested_on, reference_no: 'CHQ/4410' },
      },
    );
    expect(paid.status).toBe('paid');

    const after = await call<{
      balances: Array<{ credited: number; paid_out: number; pending: number; available: number }>;
    }>(listWithdrawals, 'GET', `/api/v1/profit-withdrawals?balances_for=${story.customerId}`);
    // never stored: credited less paid less pending, worked out every time
    expect(after.balances[0]).toMatchObject({
      credited: 180_000,
      paid_out: 150_000,
      pending: 0,
      available: 30_000,
    });
  });

  /* -------------------------------------------------------------- *
   * 8. What the chain leaves behind
   * -------------------------------------------------------------- */

  it('8. leaves one investor, one purchase, and a trail of every write', async () => {
    // the hotel still shows 480 of its 500 offered shares for sale
    const offering = await db.shareOffering.findUniqueOrThrow({
      where: { id: story.offeringId },
      select: { total_shares: true, status: true },
    });
    expect(offering.total_shares).toBe(500);
    const sold = await db.shareSale.aggregate({
      where: { offering_id: story.offeringId, status: { in: ['reserved', 'agreement_signed', 'fully_paid'] } },
      _sum: { shares: true },
    });
    expect(sold._sum.shares).toBe(20);

    // one person, one file: the lead and the customer are the same human
    expect(await db.lead.count()).toBe(1);
    expect(await db.customer.count()).toBe(1);
    const customer = await db.customer.findUniqueOrThrow({
      where: { id: story.customerId },
      select: { lead_id: true, phone: true },
    });
    expect(customer.lead_id).toBe(story.leadId);

    // the receipts are immutable, so the schedule is read through them
    const payments = await db.sharePayment.count({ where: { sale_id: story.saleId } });
    expect(payments).toBe(2);
    const allocations = await db.sharePaymentAllocation.count();
    expect(allocations).toBeGreaterThan(0);

    /*
     * And every one of those writes left an audit row — the extension does it,
     * so no service had to remember. This is the cheapest possible check that
     * it is still wired to all of the tables the story touches.
     */
    const audited = await db.auditLog.groupBy({ by: ['table_name'], _count: { _all: true } });
    const tables = new Set(audited.map((row: { table_name: string }) => row.table_name));
    for (const table of [
      'projects',
      'leads',
      'lead_activities',
      'customers',
      'share_offerings',
      'share_sales',
      'share_payments',
      'revenue_entries',
      'revenue_periods',
      'profit_allocations',
      'profit_withdrawals',
    ]) {
      expect(tables, `no audit row for ${table}`).toContain(table);
    }
  });
});
