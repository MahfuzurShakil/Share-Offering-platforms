import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as getPayable } from '@/app/api/v1/commission-payouts/payable/route';
import { GET as getPayout } from '@/app/api/v1/commission-payouts/[id]/route';
import { GET as listPayouts, POST as pay } from '@/app/api/v1/commission-payouts/route';
import { DELETE as deletePlan, PATCH as patchPlan } from '@/app/api/v1/commission-plans/[id]/route';
import { GET as listPlans, POST as createPlan } from '@/app/api/v1/commission-plans/route';
import { POST as approve } from '@/app/api/v1/commissions/approve/route';
import { GET as listCommissions } from '@/app/api/v1/commissions/route';
import { GET as getHistory } from '@/app/api/v1/org-members/[id]/history/route';
import { POST as move } from '@/app/api/v1/org-members/[id]/move/route';
import { DELETE as deleteMember, PATCH as patchMember } from '@/app/api/v1/org-members/[id]/route';
import { GET as getStatement } from '@/app/api/v1/org-members/[id]/statement/route';
import { PATCH as setStatus } from '@/app/api/v1/org-members/[id]/status/route';
import { GET as listMembers, POST as createMember } from '@/app/api/v1/org-members/route';
import { GET as getTree } from '@/app/api/v1/org-members/tree/route';
import {
  GET as getSaleCommission,
  PATCH as setSoldBy,
} from '@/app/api/v1/share-sales/[id]/commission/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The sales organisation and what a sale earns.
 *
 * Two things carry the module, and most of these are about them: commission is
 * read from the tree **as it was on the sale date**, and a stage is released
 * by the payment ledger reaching it rather than by anybody marking it. The
 * rest is the money arithmetic the plan's own worked example sets out
 * (REVENUE-SHARE-PLAN.md §7.1).
 */

const suite = hasTestDb ? describe : describe.skip;
type Json = Record<string, unknown>;

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
const LAKH = 100_000;

suite('sales team and commission API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let viewerToken: string;

  /** The designations, by name — seeded reference data in the real database. */
  const designation: Record<string, string> = {};

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
            { module: 'sales_team', level: 'full' },
            { module: 'share_sale', level: 'full' },
            { module: 'project', level: 'full' },
            { module: 'finance_expense', level: 'full' },
          ],
        },
      },
    });
    await db.role.create({
      data: {
        code: 'sales_executive',
        name: 'Sales Executive',
        permissions: {
          create: [
            { module: 'sales_team', level: 'view' },
            { module: 'share_sale', level: 'own' },
          ],
        },
      },
    });
    await db.user.create({
      data: { name: 'Nasreen', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Arif', phone: '01711000002', password_hash: hash, role_code: 'sales_executive' },
    });
    token = await signIn('01711000001');
    viewerToken = await signIn('01711000002');

    // the designation list the client edits in Master Data; the rank is the order
    const names = ['Founder', 'Team Lead', 'Sales Executive'];
    for (const [index, value] of names.entries()) {
      const row = await db.lookupValue.create({
        data: { category: 'org_designation', value, sort_order: index + 1, is_system: true },
      });
      designation[value] = row.id;
    }
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /* -------------------------------------------------------------- *
   * Helpers
   * -------------------------------------------------------------- */

  async function member(
    name: string,
    role: keyof typeof designation,
    extra: Json = {},
    as = token,
  ): Promise<{ status: number; data: Json; error?: Json }> {
    const response = await createMember(
      req('POST', '/api/v1/org-members', {
        token: as,
        body: {
          name,
          designation_id: designation[role as string],
          joined_on: '2026-01-01',
          ...extra,
        },
      }),
      undefined,
    );
    const body = (await response.json()) as { data: Json; error?: Json };
    return { status: response.status, data: body.data, error: body.error };
  }

  async function members(query = ''): Promise<Json[]> {
    const response = await listMembers(
      req('GET', `/api/v1/org-members${query}`, { token }),
      undefined,
    );
    return ((await response.json()) as { data: Json[] }).data;
  }

  /* -------------------------------------------------------------- *
   * The organisation
   * -------------------------------------------------------------- */

  it('numbers members without a year, because a member is not a document of one', async () => {
    const founder = await member('Kamal Hossain', 'Founder');
    expect(founder.status).toBe(201);
    expect(founder.data).toMatchObject({
      code: 'ORG-001',
      name: 'Kamal Hossain',
      designation: 'Founder',
      rank: 1,
      status: 'active',
      parent_id: null,
      team_size: 0,
    });

    const second = await member('Rina Chowdhury', 'Team Lead');
    expect(second.data.code).toBe('ORG-002');
  });

  it('builds a tree of any depth, and counts each branch', async () => {
    const founder = await member('Kamal Hossain', 'Founder');
    const lead = await member('Rina Chowdhury', 'Team Lead', { parent_id: founder.data.id });
    await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });
    await member('Shohel Rana', 'Sales Executive', { parent_id: lead.data.id });

    const response = await getTree(req('GET', '/api/v1/org-members/tree', { token }), undefined);
    const tree = ((await response.json()) as { data: Json[] }).data;

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'Kamal Hossain', team_size: 3 });
    const children = tree[0]!.children as Json[];
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ name: 'Rina Chowdhury', team_size: 2 });
    expect((children[0]!.children as Json[]).map((row) => row.name)).toEqual([
      'Arif Islam',
      'Shohel Rana',
    ]);
  });

  it('refuses a member under their own team, and a login used twice', async () => {
    const founder = await member('Kamal Hossain', 'Founder');
    const lead = await member('Rina Chowdhury', 'Team Lead', { parent_id: founder.data.id });

    const loop = await move(
      req('POST', `/api/v1/org-members/${founder.data.id}/move`, {
        token,
        body: { to_parent_id: lead.data.id, effective_date: '2026-06-01' },
      }),
      ctx(founder.data.id as string),
    );
    expect(loop.status).toBe(422);
    expect(((await loop.json()) as { error: { message: string } }).error.message).toContain(
      'their own team',
    );

    const arifUser = await db.user.findFirstOrThrow({ where: { name: 'Arif' } });
    const first = await member('Arif Islam', 'Sales Executive', { user_id: arifUser.id });
    expect(first.status).toBe(201);
    const twice = await member('Arif again', 'Sales Executive', { user_id: arifUser.id });
    expect(twice.status).toBe(422);
    expect(JSON.stringify(twice.error)).toContain('ORG-');
  });

  it('records a move, and will not back-date one behind the last', async () => {
    const founderA = await member('Kamal Hossain', 'Founder');
    const founderB = await member('Shirin Akter', 'Founder');
    const lead = await member('Rina Chowdhury', 'Team Lead', { parent_id: founderA.data.id });

    const moved = await move(
      req('POST', `/api/v1/org-members/${lead.data.id}/move`, {
        token,
        body: { to_parent_id: founderB.data.id, effective_date: '2026-06-01', note: 'New region' },
      }),
      ctx(lead.data.id as string),
    );
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { data: Json }).data.parent_id).toBe(founderB.data.id);

    const history = await getHistory(
      req('GET', `/api/v1/org-members/${lead.data.id}/history`, { token }),
      ctx(lead.data.id as string),
    );
    expect(((await history.json()) as { data: Json[] }).data[0]).toMatchObject({
      from_parent_name: 'Kamal Hossain',
      to_parent_name: 'Shirin Akter',
      effective_date: '2026-06-01',
      note: 'New region',
    });

    const back = await move(
      req('POST', `/api/v1/org-members/${lead.data.id}/move`, {
        token,
        body: { to_parent_id: founderA.data.id, effective_date: '2026-03-01' },
      }),
      ctx(lead.data.id as string),
    );
    expect(back.status).toBe(422);
  });

  it('leaves moving somebody to a manager, and the member form cannot do it', async () => {
    const founder = await member('Kamal Hossain', 'Founder');
    const lead = await member('Rina Chowdhury', 'Team Lead');

    const refused = await move(
      req('POST', `/api/v1/org-members/${lead.data.id}/move`, {
        token: viewerToken,
        body: { to_parent_id: founder.data.id, effective_date: '2026-06-01' },
      }),
      ctx(lead.data.id as string),
    );
    expect(refused.status).toBe(403);

    /*
     * The member route has no `parent_id` at all: a reporting line that could
     * be edited in place would lose the date commission depends on.
     */
    const sneaky = await patchMember(
      req('PATCH', `/api/v1/org-members/${lead.data.id}`, {
        token,
        body: { parent_id: founder.data.id },
      }),
      ctx(lead.data.id as string),
    );
    expect(sneaky.status).toBe(200);
    const after = await members();
    expect(after.find((row) => row.id === lead.data.id)?.parent_id).toBeNull();
  });

  it('will not let somebody leave while their team reports to them', async () => {
    const lead = await member('Rina Chowdhury', 'Team Lead');
    await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });

    const refused = await setStatus(
      req('PATCH', `/api/v1/org-members/${lead.data.id}/status`, {
        token,
        body: { status: 'left', left_on: '2026-09-30' },
      }),
      ctx(lead.data.id as string),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      'Move them',
    );
  });

  /* -------------------------------------------------------------- *
   * A plan, a sale, and what it earns
   * -------------------------------------------------------------- */

  /**
   * The plan's own worked example: 10% to the seller, 1% to the Team Lead,
   * 0.5% to the Founder, released 20 / 30 / 50 as the money arrives.
   */
  const WORKED_EXAMPLE = () => ({
    name: 'Share sale — standard',
    applies_to: 'share_sale' as const,
    seller_basis: 'pct' as const,
    seller_value: 10,
    stages: [
      {
        key: 'signed',
        label: 'Agreement + down payment',
        trigger: 'agreement_down_payment' as const,
        release_type: 'pct' as const,
        release_value: 20,
      },
      {
        key: 'half',
        label: '50% paid',
        trigger: 'paid_pct' as const,
        threshold_pct: 50,
        release_type: 'pct' as const,
        release_value: 30,
      },
      {
        key: 'full',
        label: 'Fully paid',
        trigger: 'fully_paid' as const,
        release_type: 'pct' as const,
        release_value: 50,
      },
    ],
    overrides: [
      { designation_id: designation['Team Lead']!, basis: 'pct' as const, value: 1 },
      { designation_id: designation.Founder!, basis: 'pct' as const, value: 0.5 },
    ],
    cancel_rule: 'recover' as const,
    effective_from: '2026-01-01',
    status: 'active' as const,
  });

  async function plan(body: Json = {}, as = token) {
    const response = await createPlan(
      req('POST', '/api/v1/commission-plans', {
        token: as,
        body: { ...WORKED_EXAMPLE(), ...body },
      }),
      undefined,
    );
    const envelope = (await response.json()) as { data: Json; error?: { message: string } };
    return { status: response.status, data: envelope.data, error: envelope.error };
  }

  it('numbers a plan without a year and checks one that goes active', async () => {
    const good = await plan();
    expect(good.status).toBe(201);
    expect(good.data).toMatchObject({ code: 'CMP-001', status: 'active', seller_value: 10 });

    // the stages have to add up to 100% of what the person earns
    const broken = await plan({
      stages: WORKED_EXAMPLE().stages.map((stage) => ({ ...stage, release_value: 20 })),
    });
    expect(broken.status).toBe(422);
    expect(broken.error?.message).toContain('add up to 100%');

    // a draft may be saved half-written: somebody is still thinking about it
    const draft = await plan({ status: 'draft', seller_value: 0, stages: [] });
    expect(draft.status).toBe(201);
    expect(draft.data.code).toBe('CMP-002');
  });

  /**
   * A project, a round, and an investor to sell 10 shares to at 1 lakh each.
   *
   * The codes are counted rather than fixed, because a test that needs a
   * second sale needs a second project to hang it on.
   */
  let projects = 0;

  async function sellableProject() {
    const n = String(++projects).padStart(3, '0');
    const project = await db.project.create({
      data: {
        code: `PRJ-2026-${n}`,
        name: 'Sea Pearl Hotel',
        valuation: '100000000.00',
        total_shares: 1000,
        sales_status: 'open',
      },
    });
    const offering = await db.shareOffering.create({
      data: {
        code: `OFR-2026-${n}`,
        project_id: project.id,
        round_no: 1,
        net_asset_value: '100000000.00',
        premium_value: '0.00',
        valuation: '100000000.00',
        valuation_date: new Date('2026-01-01T00:00:00Z'),
        offered_pct: '50.000000',
        total_shares: 500,
        share_pct: '0.100000',
        price_per_share: '100000.00',
        min_down_payment_pct: '20.000',
        max_installments: 4,
        status: 'open',
      },
    });
    const customer = await db.customer.create({
      data: { code: `CUST-2026-${n}`, name: 'Rahim Uddin', phone: `018112233${n}` },
    });
    return { project, offering, customer };
  }

  /**
   * A signed purchase of 10 shares — Tk 10,00,000 — with the down payment
   * paid, written straight to the database because what is being tested is the
   * commission engine rather than the share-sale service.
   */
  async function signedSale(
    soldBy: string | null,
    options: { paid?: number; status?: 'agreement_signed' | 'reserved' | 'cancelled' } = {},
  ) {
    const { project, offering, customer } = await sellableProject();
    const sale = await db.shareSale.create({
      data: {
        code: 'SHR-2026-001',
        offering_id: offering.id,
        project_id: project.id,
        customer_id: customer.id,
        shares: 10,
        share_pct: '1.000000',
        price_per_share: '100000.00',
        total_price: '1000000.00',
        down_payment: '200000.00',
        installment_count: 4,
        reserved_on: new Date('2026-02-01T00:00:00Z'),
        hold_until: new Date('2026-02-08T00:00:00Z'),
        agreement_date: new Date('2026-02-05T00:00:00Z'),
        agreement_no: 'AGR-2026-001',
        status: options.status ?? 'agreement_signed',
        sold_by_member_id: soldBy,
      },
    });
    if (options.paid) {
      await db.sharePayment.create({
        data: {
          code: 'SRC-2026-0001',
          sale_id: sale.id,
          paid_on: new Date('2026-02-05T00:00:00Z'),
          amount: String(options.paid),
          principal: String(options.paid),
          late_fee: '0.00',
          method: 'bank_transfer',
        },
      });
    }
    return { sale, project, customer };
  }

  async function commissions(query = '') {
    const response = await listCommissions(
      req('GET', `/api/v1/commissions${query}`, { token }),
      undefined,
    );
    const body = (await response.json()) as {
      data: { rows: Json[]; totals: Json };
      meta: { total: number };
    };
    return { rows: body.data.rows, totals: body.data.totals, total: body.meta.total };
  }

  it('earns the seller and the uplines the amounts the plan works out', async () => {
    await plan();
    const founder = await member('Kamal Hossain', 'Founder');
    const lead = await member('Rina Chowdhury', 'Team Lead', { parent_id: founder.data.id });
    const seller = await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });

    // agreement signed and the 2 lakh down payment in: the first stage only
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    const { rows, totals } = await commissions();
    // three people, three stages each
    expect(rows).toHaveLength(9);

    const of = (name: string, stage: string) =>
      rows.find((row) => row.member_name === name && row.stage_key === stage);

    // seller: 10% of 10,00,000 = 1,00,000, released 20 / 30 / 50
    expect(of('Arif Islam', 'signed')).toMatchObject({ amount: 20_000, status: 'earned' });
    expect(of('Arif Islam', 'half')).toMatchObject({ amount: 30_000, status: 'pending' });
    expect(of('Arif Islam', 'full')).toMatchObject({ amount: 50_000, status: 'pending' });
    // Team Lead override 1% = 10,000; Founder 0.5% = 5,000
    expect(of('Rina Chowdhury', 'signed')).toMatchObject({ amount: 2_000, role: 'override', level: 1 });
    expect(of('Kamal Hossain', 'signed')).toMatchObject({ amount: 1_000, role: 'override', level: 2 });
    expect(of('Kamal Hossain', 'full')).toMatchObject({ amount: 2_500 });

    // the designation is the word it was at the time, not a live lookup
    expect(of('Arif Islam', 'signed')?.designation_at_sale).toBe('Sales Executive');
    expect(totals).toMatchObject({ earned: 23_000, pending: 92_000 });
  });

  it('reads the tree as it was on the sale date, not as it is now', async () => {
    await plan();
    const first = await member('Kamal Hossain', 'Founder');
    const second = await member('Shirin Akter', 'Founder');
    const lead = await member('Rina Chowdhury', 'Team Lead', { parent_id: first.data.id });
    const seller = await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });

    await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    const before = (await commissions()).rows;
    expect(before.some((row) => row.member_name === 'Kamal Hossain')).toBe(true);

    /*
     * The lead moves to the other founder *after* the sale. The already-earned
     * override stays with the founder who had them on the day — which is the
     * whole reason `org_moves` exists.
     */
    await move(
      req('POST', `/api/v1/org-members/${lead.data.id}/move`, {
        token,
        body: { to_parent_id: second.data.id, effective_date: '2026-08-01' },
      }),
      ctx(lead.data.id as string),
    );

    const after = (await commissions()).rows;
    expect(after.some((row) => row.member_name === 'Kamal Hossain')).toBe(true);
    expect(after.some((row) => row.member_name === 'Shirin Akter')).toBe(false);
  });

  it('releases the next stage when the ledger reaches it, and takes it back if it is reversed', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    const { sale } = await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    expect((await commissions('?status=earned')).rows).toHaveLength(1);

    // another 3 lakh takes him past half the price
    await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0002',
        sale_id: sale.id,
        paid_on: new Date('2026-03-05T00:00:00Z'),
        amount: '300000.00',
        principal: '300000.00',
        late_fee: '0.00',
        method: 'bank_transfer',
      },
    });

    const half = await commissions('?status=earned');
    expect(half.rows.map((row) => row.stage_key).sort()).toEqual(['half', 'signed']);
    expect(half.totals).toMatchObject({ earned: 50_000 });

    /*
     * A reversing receipt is a negative row, so the cumulative total drops
     * back below the threshold and the stage un-earns itself. Nobody marks
     * anything.
     */
    await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0003',
        sale_id: sale.id,
        paid_on: new Date('2026-03-10T00:00:00Z'),
        amount: '-300000.00',
        principal: '-300000.00',
        late_fee: '0.00',
        method: 'bank_transfer',
      },
    });
    expect((await commissions('?status=earned')).rows.map((row) => row.stage_key)).toEqual([
      'signed',
    ]);
  });

  it('starts the commission when somebody says who sold it, and fixes the seller once it is earned', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    const other = await member('Shohel Rana', 'Sales Executive');
    const { sale } = await signedSale(null, { paid: 2 * LAKH });

    // nobody sold it yet, so there is nothing to earn
    expect((await commissions()).rows).toHaveLength(0);

    const named = await setSoldBy(
      req('PATCH', `/api/v1/share-sales/${sale.id}/commission`, {
        token,
        body: { sold_by_member_id: seller.data.id },
      }),
      ctx(sale.id),
    );
    expect(named.status).toBe(200);
    expect(((await named.json()) as { data: Json[] }).data).toHaveLength(3);

    const moved = await setSoldBy(
      req('PATCH', `/api/v1/share-sales/${sale.id}/commission`, {
        token,
        body: { sold_by_member_id: other.data.id },
      }),
      ctx(sale.id),
    );
    expect(moved.status).toBe(409);
    expect(((await moved.json()) as { error: { message: string } }).error.message).toContain(
      'already been earned',
    );
  });

  it('voids what was never paid when the sale is cancelled', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    const { sale } = await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    expect((await commissions()).rows).toHaveLength(3);

    await db.shareSale.update({ where: { id: sale.id }, data: { status: 'cancelled' } });

    const after = await commissions();
    expect(after.rows.every((row) => row.status === 'void')).toBe(true);
    expect(after.rows[0]?.void_reason).toContain('cancelled');
    expect(after.totals).toMatchObject({ earned: 0, pending: 0 });
  });

  /* -------------------------------------------------------------- *
   * Approving and paying
   * -------------------------------------------------------------- */

  async function earnedLineIds(): Promise<string[]> {
    return (await commissions('?status=earned')).rows.map((row) => row.id as string);
  }

  it('approves only earned commission, then pays it with tax withheld', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    const pending = (await commissions('?status=pending')).rows.map((row) => row.id as string);
    const tooSoon = await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids: pending } }),
      undefined,
    );
    expect(tooSoon.status).toBe(409);

    const ids = await earnedLineIds();
    const approved = await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids } }),
      undefined,
    );
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { data: { approved: number } }).data.approved).toBe(1);

    const payable = await getPayable(
      req('GET', '/api/v1/commission-payouts/payable', { token }),
      undefined,
    );
    const waiting = ((await payable.json()) as { data: Json[] }).data;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ lines_total: 20_000, recover_now: 0 });

    const paid = await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: {
          member_id: seller.data.id,
          paid_on: '2026-03-31',
          tax_pct: 10,
          reference_no: 'CHQ/118',
        },
      }),
      undefined,
    );
    expect(paid.status).toBe(201);
    expect(((await paid.json()) as { data: Json }).data).toMatchObject({
      code: 'CPO-2026-001',
      lines_total: 20_000,
      recovered: 0,
      tax_withheld: 2_000,
      net: 18_000,
      line_count: 1,
    });

    // nothing left waiting, and the line now points at the payout
    expect(
      ((await (await getPayable(req('GET', '/api/v1/commission-payouts/payable', { token }), undefined)).json()) as {
        data: Json[];
      }).data,
    ).toHaveLength(0);
    expect((await commissions('?status=paid')).rows).toHaveLength(1);
  });

  it('takes paid commission back off the next payout when the sale is cancelled', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    const { sale } = await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    // the first stage is earned, approved and paid
    await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids: await earnedLineIds() } }),
      undefined,
    );
    await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: { member_id: seller.data.id, paid_on: '2026-03-31', tax_pct: 0 },
      }),
      undefined,
    );

    // then the whole thing is cancelled
    await db.shareSale.update({ where: { id: sale.id }, data: { status: 'cancelled' } });
    const afterCancel = await commissions();
    const recoverable = afterCancel.rows.find((row) => row.status === 'paid');
    expect(recoverable?.to_recover).toBe(true);
    expect(afterCancel.totals).toMatchObject({ to_recover: 20_000 });

    /*
     * He sells something else, so there is commission for the recovery to come
     * out of — which is what "recovered from future commission" means.
     */
    const second = await sellableProject();
    const next = await db.shareSale.create({
      data: {
        code: 'SHR-2026-002',
        offering_id: second.offering.id,
        project_id: second.project.id,
        customer_id: second.customer.id,
        shares: 10,
        share_pct: '1.000000',
        price_per_share: '100000.00',
        total_price: '1000000.00',
        down_payment: '200000.00',
        installment_count: 4,
        reserved_on: new Date('2026-04-01T00:00:00Z'),
        hold_until: new Date('2026-04-08T00:00:00Z'),
        agreement_date: new Date('2026-04-05T00:00:00Z'),
        status: 'agreement_signed',
        sold_by_member_id: seller.data.id as string,
      },
    });
    await db.sharePayment.create({
      data: {
        code: 'SRC-2026-0009',
        sale_id: next.id,
        paid_on: new Date('2026-04-05T00:00:00Z'),
        amount: '200000.00',
        principal: '200000.00',
        late_fee: '0.00',
        method: 'bank_transfer',
      },
    });

    await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids: await earnedLineIds() } }),
      undefined,
    );
    const second_payout = await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: { member_id: seller.data.id, paid_on: '2026-04-30', tax_pct: 0 },
      }),
      undefined,
    );
    const body = ((await second_payout.json()) as { data: Json }).data;
    // 20,000 earned, 20,000 taken back: he is paid nothing and owes nothing
    expect(body).toMatchObject({ lines_total: 20_000, recovered: 20_000, net: 0 });

    const detail = await getPayout(
      req('GET', `/api/v1/commission-payouts/${body.id}`, { token }),
      ctx(body.id as string),
    );
    const parts = (await detail.json()) as { data: { paid: Json[]; recovered: Json[] } };
    expect(parts.data.paid).toHaveLength(1);
    expect(parts.data.recovered).toHaveLength(1);
    expect(parts.data.recovered[0]?.status).toBe('recovered');
  });

  it('refuses to pay a member with nothing approved, and to change a paid-out payout', async () => {
    const seller = await member('Arif Islam', 'Sales Executive');
    const nothing = await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: { member_id: seller.data.id, paid_on: '2026-03-31' },
      }),
      undefined,
    );
    expect(nothing.status).toBe(409);

    await plan();
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids: await earnedLineIds() } }),
      undefined,
    );
    const made = await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: { member_id: seller.data.id, paid_on: '2026-03-31' },
      }),
      undefined,
    );
    const payout = ((await made.json()) as { data: Json }).data;

    // the database itself refuses it: money that left is corrected by more money
    await expect(
      db.commissionPayout.update({ where: { id: payout.id as string }, data: { net: '1.00' } }),
    ).rejects.toThrow(/not allowed/);
  });

  /* -------------------------------------------------------------- *
   * The statement
   * -------------------------------------------------------------- */

  it('shows a member one block per sale, with what is released and what is to come', async () => {
    await plan();
    const lead = await member('Rina Chowdhury', 'Team Lead');
    const seller = await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    const response = await getStatement(
      req('GET', `/api/v1/org-members/${seller.data.id}/statement`, { token }),
      ctx(seller.data.id as string),
    );
    const statement = ((await response.json()) as {
      data: { member: Json; sales: Json[]; totals: Json };
    }).data;

    expect(statement.member).toMatchObject({ name: 'Arif Islam' });
    expect(statement.sales).toHaveLength(1);
    expect(statement.sales[0]).toMatchObject({
      sale_code: 'AGR-2026-001',
      customer_name: 'Rahim Uddin',
      role: 'seller',
      total: 100_000,
    });
    expect((statement.sales[0]!.lines as Json[]).map((line) => line.stage_key)).toEqual([
      'signed',
      'half',
      'full',
    ]);
    expect(statement.totals).toMatchObject({ earned: 20_000, pending: 80_000 });

    // the lead's own statement shows the same sale as an override
    const leadStatement = await getStatement(
      req('GET', `/api/v1/org-members/${lead.data.id}/statement`, { token }),
      ctx(lead.data.id as string),
    );
    const theirs = ((await leadStatement.json()) as { data: { sales: Json[] } }).data;
    expect(theirs.sales[0]).toMatchObject({ role: 'override', total: 10_000 });
  });

  it('shows a lead their whole branch', async () => {
    await plan();
    const lead = await member('Rina Chowdhury', 'Team Lead');
    const seller = await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    const branch = await commissions(`?team_of=${lead.data.id}`);
    // the lead's three override lines and the seller's three
    expect(branch.rows).toHaveLength(6);
    expect(new Set(branch.rows.map((row) => row.member_name))).toEqual(
      new Set(['Rina Chowdhury', 'Arif Islam']),
    );
  });

  /* -------------------------------------------------------------- *
   * What the module refuses to lose
   * -------------------------------------------------------------- */

  it('keeps a plan that has earned, and a member who has sold', async () => {
    const made = await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    await commissions();

    const rewrite = await patchPlan(
      req('PATCH', `/api/v1/commission-plans/${made.data.id}`, {
        token,
        body: { seller_value: 15 },
      }),
      ctx(made.data.id as string),
    );
    expect(rewrite.status).toBe(409);
    expect(((await rewrite.json()) as { error: { message: string } }).error.message).toContain(
      'Retire it',
    );

    // the name and the status may still move: retiring is how terms change
    const retired = await patchPlan(
      req('PATCH', `/api/v1/commission-plans/${made.data.id}`, {
        token,
        body: { status: 'retired', notes: 'Replaced by the 2027 plan' },
      }),
      ctx(made.data.id as string),
    );
    expect(retired.status).toBe(200);

    const gone = await deletePlan(
      req('DELETE', `/api/v1/commission-plans/${made.data.id}`, { token }),
      ctx(made.data.id as string),
    );
    expect(gone.status).toBe(409);

    const member_gone = await deleteMember(
      req('DELETE', `/api/v1/org-members/${seller.data.id}`, { token }),
      ctx(seller.data.id as string),
    );
    expect(member_gone.status).toBe(409);
    expect(((await member_gone.json()) as { error: { message: string } }).error.message).toContain(
      'left instead',
    );
  });

  it('deletes a member who was typed by mistake', async () => {
    const typo = await member('Typo', 'Sales Executive');
    const gone = await deleteMember(
      req('DELETE', `/api/v1/org-members/${typo.data.id}`, { token }),
      ctx(typo.data.id as string),
    );
    expect(gone.status).toBe(204);
    expect(await members()).toHaveLength(0);
  });

  it('counts what a branch sold on the org chart', async () => {
    await plan();
    const lead = await member('Rina Chowdhury', 'Team Lead');
    const seller = await member('Arif Islam', 'Sales Executive', { parent_id: lead.data.id });
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    const rows = await members();
    const theLead = rows.find((row) => row.id === lead.data.id);
    const theSeller = rows.find((row) => row.id === seller.data.id);
    expect(theSeller).toMatchObject({ own_sales: 1_000_000, own_sales_count: 1 });
    // the lead sold nothing themselves, and their branch sold the lot
    expect(theLead).toMatchObject({
      own_sales: 0,
      branch_sales: 1_000_000,
      branch_sales_count: 1,
      team_size: 1,
    });
  });

  it('writes an audit row for the organisation, the plans and the payouts', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    const lead = await member('Rina Chowdhury', 'Team Lead');
    await move(
      req('POST', `/api/v1/org-members/${seller.data.id}/move`, {
        token,
        body: { to_parent_id: lead.data.id, effective_date: '2026-02-01' },
      }),
      ctx(seller.data.id as string),
    );
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids: await earnedLineIds() } }),
      undefined,
    );
    await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: { member_id: seller.data.id, paid_on: '2026-03-31' },
      }),
      undefined,
    );

    const rows = await db.auditLog.groupBy({ by: ['table_name'], _count: { _all: true } });
    const tables = new Set(rows.map((row: { table_name: string }) => row.table_name));
    for (const table of [
      'org_members',
      'org_moves',
      'commission_plans',
      'commission_lines',
      'commission_payouts',
    ]) {
      expect(tables, `no audit row for ${table}`).toContain(table);
    }
  });

  it('lists the plans with how many lines came from each', async () => {
    const made = await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    await commissions();

    const response = await listPlans(req('GET', '/api/v1/commission-plans', { token }), undefined);
    const rows = ((await response.json()) as { data: Json[] }).data;
    expect(rows.find((row) => row.id === made.data.id)).toMatchObject({ sales: 3 });
  });

  it('lists the payouts newest first', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    await signedSale(seller.data.id as string, { paid: 2 * LAKH });
    await approve(
      req('POST', '/api/v1/commissions/approve', { token, body: { ids: await earnedLineIds() } }),
      undefined,
    );
    await pay(
      req('POST', '/api/v1/commission-payouts', {
        token,
        body: { member_id: seller.data.id, paid_on: '2026-03-31' },
      }),
      undefined,
    );

    const response = await listPayouts(
      req('GET', '/api/v1/commission-payouts', { token }),
      undefined,
    );
    const body = (await response.json()) as { data: Json[]; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({ member_name: 'Arif Islam', net: 20_000 });
  });

  it('gives a purchase its own commission view', async () => {
    await plan();
    const seller = await member('Arif Islam', 'Sales Executive');
    const { sale } = await signedSale(seller.data.id as string, { paid: 2 * LAKH });

    const response = await getSaleCommission(
      req('GET', `/api/v1/share-sales/${sale.id}/commission`, { token }),
      ctx(sale.id),
    );
    const rows = ((await response.json()) as { data: Json[] }).data;
    expect(rows).toHaveLength(3);
    // the seller first, then the stages in order
    expect(rows.map((row) => row.stage_seq)).toEqual([0, 1, 2]);
  });
});
