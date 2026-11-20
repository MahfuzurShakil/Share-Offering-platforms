import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getAccount, PATCH as patchAccount, DELETE as deleteAccount } from '@/app/api/v1/accounts/[id]/route';
import { GET as listAccounts, POST as createAccount } from '@/app/api/v1/accounts/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as getHistory } from '@/app/api/v1/partners/[id]/history/route';
import { DELETE as deletePartner, PATCH as patchPartner } from '@/app/api/v1/partners/[id]/route';
import { GET as listPartners, POST as createPartner } from '@/app/api/v1/partners/route';
import { GET as getCapTable } from '@/app/api/v1/projects/[id]/cap-table/route';
import { POST as closePeriod } from '@/app/api/v1/projects/[id]/revenue/periods/route';
import { POST as createEntry } from '@/app/api/v1/projects/[id]/revenue/entries/route';
import { PUT as putPolicy } from '@/app/api/v1/projects/[id]/revenue/route';
import { PATCH as movePeriod } from '@/app/api/v1/revenue-periods/[id]/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * Accounts and partners — the slice the rest of the product was waiting for.
 *
 * The weight of it is the last test: the owners' side of a profit declaration
 * stops being one unattributed line and becomes one line per partner, split on
 * the record date. Everything above it is the bookkeeping that has to be right
 * for that to mean anything — above all that a percentage changed later must
 * not re-split a period already declared.
 */

const suite = hasTestDb ? describe : describe.skip;
type Json = Record<string, unknown>;

function req(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

const YEAR = new Date().getUTCFullYear() - 1;
const Q1 = { start: `${YEAR}-01-01`, end: `${YEAR}-03-31` };
const CRORE = 10_000_000;
const LAKH = 100_000;

suite('accounts and partners API', () => {
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
            { module: 'finance_expense', level: 'full' },
            { module: 'finance_collection', level: 'full' },
            { module: 'share_sale', level: 'full' },
            { module: 'sales_team', level: 'full' },
          ],
        },
      },
    });
    /** can read an account to pick one, and may not open or change one */
    await db.role.create({
      data: {
        code: 'collections',
        name: 'Collections',
        permissions: {
          create: [
            { module: 'finance_collection', level: 'full' },
            { module: 'finance_expense', level: 'none' },
            { module: 'share_sale', level: 'view' },
          ],
        },
      },
    });
    await db.user.create({
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Clerk', phone: '01711000002', password_hash: hash, role_code: 'collections' },
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
        premium_value: '0.00',
        valuation: '1000000000.00',
        valuation_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        offered_pct: '50.000000',
        total_shares: 500,
        share_pct: '0.100000',
        price_per_share: '1000000.00',
        min_down_payment_pct: '0.000',
        max_installments: 0,
        status: 'open',
      },
    });
    offeringId = offering.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /* -------------------------------------------------------------- *
   * Helpers
   * -------------------------------------------------------------- */

  let seq = 0;

  async function account(body: Json = {}, as = token) {
    const response = await createAccount(
      req('POST', '/api/v1/accounts', {
        token: as,
        body: {
          name: 'BRAC Bank — current',
          type: 'bank',
          opening_balance: 5 * LAKH,
          opening_balance_date: `${YEAR}-01-01`,
          ...body,
        },
      }),
      undefined,
    );
    const envelope = (await response.json()) as { data: Json; error?: { message: string } };
    return { status: response.status, data: envelope.data, error: envelope.error };
  }

  async function partner(name: string, share_pct: number, body: Json = {}, as = token) {
    const response = await createPartner(
      req('POST', '/api/v1/partners', {
        token: as,
        body: { name, share_pct, effective_from: `${YEAR}-01-01`, ...body },
      }),
      undefined,
    );
    const envelope = (await response.json()) as {
      data: Json;
      error?: { message: string; fields?: Json };
    };
    return { status: response.status, data: envelope.data, error: envelope.error };
  }

  async function partners(query = '') {
    const response = await listPartners(
      req('GET', `/api/v1/partners${query}`, { token }),
      undefined,
    );
    return ((await response.json()) as { data: Json[] }).data;
  }

  /** A signed purchase of `shares` at 10 lakh each, paid in full. */
  async function holding(name: string, shares: number) {
    const n = String(++seq).padStart(3, '0');
    const customer = await db.customer.create({
      data: { code: `CUST-${YEAR}-${n}`, name, phone: `0181122${n}44` },
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
    await db.sharePayment.create({
      data: {
        code: `SRC-${YEAR}-${n}`,
        sale_id: sale.id,
        paid_on: new Date(`${YEAR}-01-05T00:00:00Z`),
        amount: `${shares * 1_000_000}.00`,
        principal: `${shares * 1_000_000}.00`,
        method: 'bank_transfer',
      },
    });
    return { customer, sale };
  }

  /* -------------------------------------------------------------- *
   * Accounts
   * -------------------------------------------------------------- */

  it('numbers an account without a year, because one is opened once', async () => {
    const first = await account();
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({
      code: 'ACC-001',
      name: 'BRAC Bank — current',
      type: 'bank',
      opening_balance: 5 * LAKH,
      opening_balance_date: `${YEAR}-01-01`,
      is_active: true,
      paid_out: 0,
    });

    const petty = await account({ name: 'Petty cash', type: 'cash', opening_balance: 20_000 });
    expect(petty.data.code).toBe('ACC-002');
  });

  it('lets the collections desk read an account but not open one', async () => {
    await account();
    const readable = await listAccounts(
      req('GET', '/api/v1/accounts', { token: viewerToken }),
      undefined,
    );
    expect(readable.status).toBe(200);
    expect(((await readable.json()) as { data: Json[] }).data).toHaveLength(1);

    const refused = await account({}, viewerToken);
    expect(refused.status).toBe(403);
  });

  it('counts what has gone out of an account, and refuses to delete one that has', async () => {
    const acc = await account();
    const { customer } = await holding('Rahim Uddin', 100);

    // a profit withdrawal paid out of it
    const period = await db.revenuePeriod.create({
      data: {
        code: `RVP-${YEAR}-001`,
        project_id: projectId,
        period_start: new Date(`${Q1.start}T00:00:00Z`),
        period_end: new Date(`${Q1.end}T00:00:00Z`),
        label: `Q1 ${YEAR}`,
        status: 'declared',
        income: '0.00',
        cost: '0.00',
        operating_profit: '0.00',
        reserve: '0.00',
        mgmt_fee: '0.00',
        available: '0.00',
        declared: '0.00',
      },
    });
    await db.profitAllocation.create({
      data: {
        period_id: period.id,
        project_id: projectId,
        holder_type: 'customer',
        customer_id: customer.id,
        ownership_pct: '10.000000',
        eligibility_factor: '1.000000',
        gross: `${LAKH}.00`,
        net_credited: `${LAKH}.00`,
      },
    });
    await db.profitWithdrawal.create({
      data: {
        code: `WDR-${YEAR}-001`,
        project_id: projectId,
        holder_type: 'customer',
        customer_id: customer.id,
        amount: `${60_000}.00`,
        method: 'bank_transfer',
        pay_to: 'BRAC 123',
        status: 'paid',
        requested_on: new Date(`${YEAR}-04-01T00:00:00Z`),
        paid_on: new Date(`${YEAR}-04-05T00:00:00Z`),
        account_id: acc.data.id as string,
      },
    });

    const after = await getAccount(
      req('GET', `/api/v1/accounts/${acc.data.id}`, { token }),
      ctx(acc.data.id as string),
    );
    expect(((await after.json()) as { data: Json }).data.paid_out).toBe(60_000);

    const refused = await deleteAccount(
      req('DELETE', `/api/v1/accounts/${acc.data.id}`, { token }),
      ctx(acc.data.id as string),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      'Switch the account off',
    );

    // switching it off is the answer, and the row stays
    const off = await patchAccount(
      req('PATCH', `/api/v1/accounts/${acc.data.id}`, { token, body: { is_active: false } }),
      ctx(acc.data.id as string),
    );
    expect(((await off.json()) as { data: Json }).data.is_active).toBe(false);
  });

  it('deletes an account nothing came out of', async () => {
    const acc = await account();
    const gone = await deleteAccount(
      req('DELETE', `/api/v1/accounts/${acc.data.id}`, { token }),
      ctx(acc.data.id as string),
    );
    expect(gone.status).toBe(204);
  });

  /* -------------------------------------------------------------- *
   * Partners
   * -------------------------------------------------------------- */

  it('writes a partner’s opening share into the history as well', async () => {
    const karim = await partner('Karim Ahmed', 50);
    expect(karim.status).toBe(201);
    expect(karim.data).toMatchObject({
      code: 'PTR-001',
      name: 'Karim Ahmed',
      share_pct: 50,
      project_id: null,
      is_active: true,
    });

    const history = await getHistory(
      req('GET', `/api/v1/partners/${karim.data.id}/history`, { token }),
      ctx(karim.data.id as string),
    );
    const rows = ((await history.json()) as { data: Json[] }).data;
    /*
     * Without this row, a declaration dated before the partner's first change
     * would have nothing on file and would fall back to today's figure — the
     * thing the history exists to prevent.
     */
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      share_pct: 50,
      effective_from: `${YEAR}-01-01`,
      note: 'Opening share',
    });
  });

  it('asks what day a changed share takes effect, and keeps the old one', async () => {
    const karim = await partner('Karim Ahmed', 50);

    const undated = await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, { token, body: { share_pct: 60 } }),
      ctx(karim.data.id as string),
    );
    expect(undated.status).toBe(422);
    expect(
      ((await undated.json()) as { error: { fields: Json } }).error.fields,
    ).toHaveProperty('effective_from');

    const dated = await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, {
        token,
        body: { share_pct: 60, effective_from: `${YEAR}-07-01`, note: 'Bought Rahim out' },
      }),
      ctx(karim.data.id as string),
    );
    expect(dated.status).toBe(200);
    expect(((await dated.json()) as { data: Json }).data.share_pct).toBe(60);

    const history = await getHistory(
      req('GET', `/api/v1/partners/${karim.data.id}/history`, { token }),
      ctx(karim.data.id as string),
    );
    const rows = ((await history.json()) as { data: Json[] }).data;
    // newest first, and the 50% they held before is still on file
    expect(rows.map((r) => r.share_pct)).toEqual([60, 50]);

    const back = await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, {
        token,
        body: { share_pct: 55, effective_from: `${YEAR}-03-01` },
      }),
      ctx(karim.data.id as string),
    );
    expect(back.status).toBe(422);
  });

  it('changes a name without touching the history', async () => {
    const karim = await partner('Karim Ahmed', 50);
    await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, {
        token,
        body: { name: 'Karim Ahmed Chowdhury', phone: '01711 22 33 44' },
      }),
      ctx(karim.data.id as string),
    );

    const rows = await partners();
    expect(rows[0]).toMatchObject({ name: 'Karim Ahmed Chowdhury', phone: '01711223344' });
    const history = await getHistory(
      req('GET', `/api/v1/partners/${karim.data.id}/history`, { token }),
      ctx(karim.data.id as string),
    );
    expect(((await history.json()) as { data: Json[] }).data).toHaveLength(1);
  });

  it('tells a project investor from a partner of the company', async () => {
    await partner('Karim Ahmed', 50);
    const investor = await partner('Shafiqul Islam', 30, { project_id: projectId });
    expect(investor.data).toMatchObject({
      project_id: projectId,
      project_name: 'Grand Palace Resort',
    });

    expect(await partners('?company_only=true')).toHaveLength(1);
    expect(await partners(`?project_id=${projectId}`)).toHaveLength(1);
    expect(await partners()).toHaveLength(2);
  });

  it('refuses a share outside 0 to 100, and a project that is gone', async () => {
    expect((await partner('Nobody', 0)).status).toBe(422);
    expect((await partner('Nobody', 120)).status).toBe(422);
    const madeUp = await partner('Nobody', 10, {
      project_id: '01a1fa1a-0000-7000-8000-000000000000',
    });
    expect(madeUp.status).toBe(422);
  });

  /* -------------------------------------------------------------- *
   * The cap table
   * -------------------------------------------------------------- */

  async function capTable(query = '') {
    const response = await getCapTable(
      req('GET', `/api/v1/projects/${projectId}/cap-table${query}`, { token }),
      ctx(projectId),
    );
    return (
      (await response.json()) as {
        data: { owners_pct: number; total_pct: number; rows: Json[] };
      }
    ).data;
  }

  it('always adds to 100%, however the project is owned', async () => {
    await partner('Karim Ahmed', 50);
    await partner('Rahim Sheikh', 30);
    await partner('Selina Begum', 20);

    // nobody has bought yet: the owners hold the lot, in their company shares
    const empty = await capTable();
    expect(empty.owners_pct).toBe(100);
    expect(empty.total_pct).toBe(100);
    expect(empty.rows.map((r) => [r.name, r.share_pct])).toEqual([
      ['Karim Ahmed', 50],
      ['Rahim Sheikh', 30],
      ['Selina Begum', 20],
    ]);

    // 250 of the project's 1,000 shares sold: the owners keep 75% between them
    await holding('Rahim Uddin', 150);
    await holding('Shirin Akter', 100);

    const sold = await capTable();
    expect(sold.owners_pct).toBe(75);
    expect(sold.total_pct).toBe(100);
    expect(sold.rows.filter((r) => r.kind === 'customer')).toHaveLength(2);
    expect(sold.rows.find((r) => r.name === 'Karim Ahmed')?.share_pct).toBe(37.5);
    expect(sold.rows.find((r) => r.basis === '150 shares')?.share_pct).toBe(15);
  });

  it("gives a project's own investor their share before the company's partners", async () => {
    await partner('Karim Ahmed', 50);
    await partner('Rahim Sheikh', 30);
    await partner('Selina Begum', 20);
    await partner('Shafiqul Islam', 30, { project_id: projectId });

    const table = await capTable();
    expect(table.total_pct).toBe(100);
    expect(table.rows.map((r) => [r.name, r.share_pct])).toEqual([
      ['Shafiqul Islam', 30],
      ['Karim Ahmed', 35],
      ['Rahim Sheikh', 21],
      ['Selina Begum', 14],
    ]);
  });

  it('reads the cap table as it stood on a day', async () => {
    const karim = await partner('Karim Ahmed', 50);
    await partner('Rahim Sheikh', 50);
    await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, {
        token,
        body: { share_pct: 80, effective_from: `${YEAR}-07-01` },
      }),
      ctx(karim.data.id as string),
    );

    const june = await capTable(`?as_of=${YEAR}-06-30`);
    expect(june.rows.map((r) => [r.name, r.share_pct])).toEqual([
      ['Karim Ahmed', 50],
      ['Rahim Sheikh', 50],
    ]);

    const august = await capTable(`?as_of=${YEAR}-08-31`);
    // 80 and 50 add to 130, so the two of them share the project 61.54 / 38.46
    expect(august.rows.find((r) => r.name === 'Karim Ahmed')?.share_pct).toBe(61.54);
    expect(august.total_pct).toBe(100);
  });

  /* -------------------------------------------------------------- *
   * What this was all for: the declaration
   * -------------------------------------------------------------- */

  async function declare(recordDate: string) {
    await putPolicy(
      req('PUT', `/api/v1/projects/${projectId}/revenue`, {
        token,
        body: {
          first_period_start: Q1.start,
          distribution_frequency: 'quarterly',
          reserve_pct: 0,
          mgmt_fee_type: 'none',
          tax_withholding_pct: 0,
          eligibility_rule: 'fully_paid',
        },
      }),
      ctx(projectId),
    );
    await createEntry(
      req('POST', `/api/v1/projects/${projectId}/revenue/entries`, {
        token,
        body: {
          entry_date: `${YEAR}-02-15`,
          direction: 'income',
          head: 'Room revenue',
          amount: 1 * CRORE,
        },
      }),
      ctx(projectId),
    );
    const closed = await closePeriod(
      req('POST', `/api/v1/projects/${projectId}/revenue/periods`, {
        token,
        body: { period_start: Q1.start },
      }),
      ctx(projectId),
    );
    const period = ((await closed.json()) as { data: { id: string } }).data;

    await movePeriod(
      req('PATCH', `/api/v1/revenue-periods/${period.id}`, {
        token,
        body: { action: 'approve', declared: 1 * CRORE },
      }),
      ctx(period.id),
    );
    const declared = await movePeriod(
      req('PATCH', `/api/v1/revenue-periods/${period.id}`, {
        token,
        body: { action: 'declare', record_date: recordDate },
      }),
      ctx(period.id),
    );
    expect(declared.status).toBe(200);
    return (
      (await declared.json()) as {
        data: {
          allocations: Array<{
            holder_type: string;
            customer_id: string | null;
            partner_id: string | null;
            ownership_pct: number;
            gross: number;
          }>;
        };
      }
    ).data.allocations;
  }

  it('splits the owners’ side of a declaration one line per partner', async () => {
    const karim = await partner('Karim Ahmed', 50);
    const rahim = await partner('Rahim Sheikh', 30);
    const selina = await partner('Selina Begum', 20);
    await holding('Rahim Uddin', 250);

    const allocations = await declare(Q1.end);

    // the investor holds 25% of the project, so 25 lakh of the crore
    const customer = allocations.filter((a) => a.holder_type === 'customer');
    expect(customer).toHaveLength(1);
    expect(customer[0]?.gross).toBe(25 * LAKH);

    /*
     * The owners' 75% is now three lines rather than one, and each names its
     * partner: 37.5 / 22.5 / 15 of the project.
     */
    const owners = allocations.filter((a) => a.holder_type === 'partner');
    expect(owners).toHaveLength(3);
    expect(owners.every((a) => a.partner_id !== null)).toBe(true);
    const by = (id: string) => owners.find((a) => a.partner_id === id);
    expect(by(karim.data.id as string)?.gross).toBe(37.5 * LAKH);
    expect(by(rahim.data.id as string)?.gross).toBe(22.5 * LAKH);
    expect(by(selina.data.id as string)?.gross).toBe(15 * LAKH);

    // and the whole thing still adds up to what was declared
    expect(allocations.reduce((sum, a) => sum + a.gross, 0)).toBe(1 * CRORE);
  });

  it('splits it by the percentages held on the record date, not today’s', async () => {
    const karim = await partner('Karim Ahmed', 50);
    const rahim = await partner('Rahim Sheikh', 50);

    /*
     * The partners rearranged themselves in July, long after the quarter being
     * declared. The declaration has to use January's percentages, or an
     * investor's own statement would change under them every time somebody
     * edited the cap table.
     */
    await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, {
        token,
        body: { share_pct: 90, effective_from: `${YEAR}-07-01` },
      }),
      ctx(karim.data.id as string),
    );
    await patchPartner(
      req('PATCH', `/api/v1/partners/${rahim.data.id}`, {
        token,
        body: { share_pct: 10, effective_from: `${YEAR}-07-01` },
      }),
      ctx(rahim.data.id as string),
    );

    const allocations = await declare(Q1.end);
    const owners = allocations.filter((a) => a.holder_type === 'partner');
    expect(owners).toHaveLength(2);
    expect(owners.find((a) => a.partner_id === karim.data.id)?.gross).toBe(50 * LAKH);
    expect(owners.find((a) => a.partner_id === rahim.data.id)?.gross).toBe(50 * LAKH);
  });

  it('still declares the owners’ part when no partner is on file', async () => {
    await holding('Rahim Uddin', 250);
    const allocations = await declare(Q1.end);

    /*
     * The fallback the module had before partners existed: the amount was
     * always right, only its breakdown was waiting. It has to keep working,
     * because a client starts with no partners entered.
     */
    const owners = allocations.filter((a) => a.holder_type === 'partner');
    expect(owners).toHaveLength(1);
    expect(owners[0]?.partner_id).toBeNull();
    expect(owners[0]?.gross).toBe(75 * LAKH);
    expect(allocations.reduce((sum, a) => sum + a.gross, 0)).toBe(1 * CRORE);
  });

  it('keeps a partner who has been credited profit', async () => {
    const karim = await partner('Karim Ahmed', 100);
    await holding('Rahim Uddin', 250);
    await declare(Q1.end);

    const refused = await deletePartner(
      req('DELETE', `/api/v1/partners/${karim.data.id}`, { token }),
      ctx(karim.data.id as string),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      'Switch them off',
    );
  });

  it('deletes a partner entered by mistake', async () => {
    const typo = await partner('Typo', 10);
    const gone = await deletePartner(
      req('DELETE', `/api/v1/partners/${typo.data.id}`, { token }),
      ctx(typo.data.id as string),
    );
    expect(gone.status).toBe(204);
    expect(await partners()).toHaveLength(0);
  });

  it('writes an audit row for the accounts, the partners and their history', async () => {
    const acc = await account();
    const karim = await partner('Karim Ahmed', 50);
    await patchPartner(
      req('PATCH', `/api/v1/partners/${karim.data.id}`, {
        token,
        body: { share_pct: 60, effective_from: `${YEAR}-07-01` },
      }),
      ctx(karim.data.id as string),
    );
    expect(acc.status).toBe(201);

    const rows = await db.auditLog.groupBy({ by: ['table_name'], _count: { _all: true } });
    const tables = new Set(rows.map((row: { table_name: string }) => row.table_name));
    for (const table of ['bank_accounts', 'partners', 'partner_share_history']) {
      expect(tables, `no audit row for ${table}`).toContain(table);
    }
  });
});
