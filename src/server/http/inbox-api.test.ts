import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listRequests, POST as createRequest } from '@/app/api/v1/share-requests/route';
import { PATCH as moveRequest } from '@/app/api/v1/share-requests/[id]/route';
import { GET as listUploads, POST as createUpload } from '@/app/api/v1/customer-uploads/route';
import { PATCH as reviewUpload } from '@/app/api/v1/customer-uploads/[id]/route';
import { GET as getUploadFile } from '@/app/api/v1/customer-uploads/[id]/file/route';
import {
  GET as listSubmissions,
  POST as createSubmission,
} from '@/app/api/v1/payment-submissions/route';
import { PATCH as reviewSubmission } from '@/app/api/v1/payment-submissions/[id]/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The portal inbox: a request to buy, a paper sent in, and "I paid at the
 * bank".
 *
 * What is really under test is the line this module exists to draw. Nothing a
 * customer sends in may be a record of anything by itself: a request must not
 * hold shares, and a submission must not be money. The one that matters most
 * is the last — when Accounts confirms a slip, the receipt has to be dated
 * **the day on the slip**, because that is the day the schedule and the late
 * fees have to see it.
 */

const suite = hasTestDb ? describe : describe.skip;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const YEAR = new Date().getUTCFullYear();

function req(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  init: { body?: unknown; form?: FormData; token?: string } = {},
) {
  const headers = new Headers();
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

suite('portal inbox API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let salesToken: string;
  let projectId: string;
  let offeringId: string;
  let customerId: string;
  let saleId: string;

  beforeAll(() => {
    process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'sharesale-inbox-'));
  });

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
    /* the sales desk may work a request but not confirm money */
    await db.role.create({
      data: {
        code: 'sales',
        name: 'Sales',
        permissions: { create: [{ module: 'share_sale', level: 'full' }] },
      },
    });
    await db.user.create({
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Seller', phone: '01711000002', password_hash: hash, role_code: 'sales' },
    });
    token = await signIn('01711000001');
    salesToken = await signIn('01711000002');

    const project = await db.project.create({
      data: {
        code: 'PRJ-2026-001',
        name: 'Shonali Bazar',
        sales_status: 'open',
        valuation: '500000000.00',
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
        net_asset_value: '500000000.00',
        valuation: '500000000.00',
        valuation_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        offered_pct: '30.000000',
        total_shares: 300,
        share_pct: '0.100000',
        price_per_share: '500000.00',
        opens_on: new Date(`${YEAR}-01-01T00:00:00Z`),
        closes_on: new Date(`${YEAR + 1}-12-31T00:00:00Z`),
        min_shares: 1,
        max_shares: 50,
        min_down_payment_pct: 20,
        max_installments: 20,
        installment_frequency: 'monthly',
        hold_days: 7,
        late_fee_type: 'pct_once',
        late_fee_pct: '2.00',
        grace_days: 7,
        status: 'open',
      },
    });
    offeringId = offering.id;

    const customer = await db.customer.create({
      data: {
        code: 'CUST-2026-001',
        name: 'Sharmin Akter',
        phone: '01811445566',
        nid: '1990123456789',
        father_or_spouse_name: 'Abdul Karim',
        address: 'Jatrabari, Dhaka',
      },
    });
    customerId = customer.id;

    /*
     * A signed purchase to pay against. Its code is deliberately outside the
     * series' own path: a fixture holding `SHR-2026-001` would collide with the
     * first code the series hands out when a test reserves for real.
     */
    const sale = await db.shareSale.create({
      data: {
        code: 'SHR-2026-900',
        offering_id: offeringId,
        project_id: projectId,
        customer_id: customerId,
        shares: 2,
        share_pct: '0.200000',
        price_per_share: '500000.00',
        total_price: '1000000.00',
        down_payment: '200000.00',
        installment_count: 2,
        reserved_on: new Date(`${YEAR}-01-01T00:00:00Z`),
        hold_until: new Date(`${YEAR}-01-08T00:00:00Z`),
        agreement_no: 'AGR-2026-900',
        agreement_date: new Date(`${YEAR}-01-01T00:00:00Z`),
        first_due_date: new Date(`${YEAR}-02-01T00:00:00Z`),
        status: 'agreement_signed',
        installments: {
          create: [
            { seq: 0, due_date: new Date(`${YEAR}-01-01T00:00:00Z`), amount: '200000.00' },
            { seq: 1, due_date: new Date(`${YEAR}-02-01T00:00:00Z`), amount: '400000.00' },
            { seq: 2, due_date: new Date(`${YEAR}-03-01T00:00:00Z`), amount: '400000.00' },
          ],
        },
      },
    });
    saleId = sale.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  /* ----------------------------------------------------------- requests */

  it('takes a request in without holding a single share, then reserves from it', async () => {
    const made = await createRequest(
      req('POST', '/api/v1/share-requests', {
        token,
        body: {
          offering_id: offeringId,
          customer_id: customerId,
          shares: 10,
          installments: 12,
          note: 'Asked how the rent is shared',
        },
      }),
      undefined,
    );
    expect(made.status).toBe(201);
    const request = (await made.json()).data as Record<string, unknown>;
    expect(request).toMatchObject({
      code: `SRQ-${YEAR}-001`,
      status: 'new',
      shares: 10,
      name: 'Sharmin Akter',
      /* 10 shares at the round's price, so a list reads at a glance */
      value: 5_000_000,
      sale_id: null,
    });

    /* nothing has left the round: the shares are still on the market */
    const offering = await db.shareOffering.findUniqueOrThrow({ where: { id: offeringId } });
    expect(offering.total_shares).toBe(300);
    expect(await db.shareSale.count({ where: { offering_id: offeringId } })).toBe(1);

    /* a note about the phone call */
    const contacted = await moveRequest(
      req('PATCH', `/api/v1/share-requests/${request.id}`, {
        token,
        body: { action: 'contacted', office_note: 'Called, sending the papers' },
      }),
      ctx(request.id as string),
    );
    expect(contacted.status).toBe(200);
    expect((await contacted.json()).data).toMatchObject({
      status: 'contacted',
      office_note: 'Called, sending the papers',
    });

    /* and now the step that actually holds shares */
    const reserved = await moveRequest(
      req('PATCH', `/api/v1/share-requests/${request.id}`, {
        token,
        body: { action: 'reserve', down_payment_pct: 20, installment_count: 12 },
      }),
      ctx(request.id as string),
    );
    expect(reserved.status).toBe(200);
    const result = (await reserved.json()).data as {
      request: { status: string; sale_id: string; sale_code: string };
      sale: { code: string; shares: number; status: string };
    };
    expect(result.request.status).toBe('reserved');
    expect(result.sale).toMatchObject({ shares: 10, status: 'reserved' });
    expect(result.request.sale_code).toBe(result.sale.code);

    /* a request already turned into a reservation cannot be worked again */
    const again = await moveRequest(
      req('PATCH', `/api/v1/share-requests/${request.id}`, {
        token,
        body: { action: 'declined', office_note: 'changed my mind' },
      }),
      ctx(request.id as string),
    );
    expect(again.status).toBe(409);
  });

  it('refuses a request against a round that is not on the market', async () => {
    await db.shareOffering.update({ where: { id: offeringId }, data: { status: 'closed' } });
    const response = await createRequest(
      req('POST', '/api/v1/share-requests', {
        token,
        body: { offering_id: offeringId, customer_id: customerId, shares: 1 },
      }),
      undefined,
    );
    expect(response.status).toBe(409);
  });

  it('will not reserve a website request until somebody is on file for it', async () => {
    const made = await createRequest(
      req('POST', '/api/v1/share-requests', {
        token,
        body: {
          offering_id: offeringId,
          shares: 4,
          source: 'website',
          prospect_name: 'Walk-in Visitor',
          prospect_phone: '01911223344',
        },
      }),
      undefined,
    );
    expect(made.status).toBe(201);
    const request = (await made.json()).data as { id: string; name: string; customer_id: null };
    expect(request).toMatchObject({ name: 'Walk-in Visitor', customer_id: null });

    const refused = await moveRequest(
      req('PATCH', `/api/v1/share-requests/${request.id}`, {
        token,
        /* paid in full at signing, which is what 0 installments means */
        body: { action: 'reserve', down_payment_pct: 100, installment_count: 0 },
      }),
      ctx(request.id),
    );
    expect(refused.status).toBe(422);

    /* naming the investor is all it needed */
    const done = await moveRequest(
      req('PATCH', `/api/v1/share-requests/${request.id}`, {
        token,
        body: {
          action: 'reserve',
          customer_id: customerId,
          down_payment_pct: 100,
          installment_count: 0,
        },
      }),
      ctx(request.id),
    );
    expect(done.status).toBe(200);
  });

  /* ------------------------------------------------------------ papers */

  it('files a paper, serves its bytes back, and keeps the office out of the queue', async () => {
    const form = new FormData();
    form.set('customer_id', customerId);
    form.set('kind', 'id_document');
    form.set('title', 'NID copy');
    form.set('file', new File([new Uint8Array(PNG)], 'nid.png', { type: 'image/png' }));

    const made = await createUpload(
      req('POST', '/api/v1/customer-uploads', { form, token }),
      undefined,
    );
    expect(made.status).toBe(201);
    const upload = (await made.json()).data as { id: string; status: string; source: string };
    /* the office put it there, so it is on file rather than waiting */
    expect(upload).toMatchObject({ status: 'accepted', source: 'office' });

    const file = await getUploadFile(
      req('GET', `/api/v1/customer-uploads/${upload.id}/file`, { token }),
      ctx(upload.id),
    );
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

    /* what the customer sends in is what waits, and a rejection needs a reason */
    const sent = new FormData();
    sent.set('customer_id', customerId);
    sent.set('kind', 'bank_proof');
    sent.set('title', 'Bank statement');
    sent.set('source', 'customer');
    sent.set('file', new File([new Uint8Array(PNG)], 'bank.png', { type: 'image/png' }));
    const theirs = (await (
      await createUpload(req('POST', '/api/v1/customer-uploads', { form: sent, token }), undefined)
    ).json()).data as { id: string; status: string };
    expect(theirs.status).toBe('under_review');

    const noReason = await reviewUpload(
      req('PATCH', `/api/v1/customer-uploads/${theirs.id}`, { token, body: { action: 'reject' } }),
      ctx(theirs.id),
    );
    expect(noReason.status).toBe(422);

    const rejected = await reviewUpload(
      req('PATCH', `/api/v1/customer-uploads/${theirs.id}`, {
        token,
        body: { action: 'reject', review_note: 'The page with the account number is missing' },
      }),
      ctx(theirs.id),
    );
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).data).toMatchObject({
      status: 'rejected',
      review_note: 'The page with the account number is missing',
    });

    const waiting = await listUploads(
      req('GET', '/api/v1/customer-uploads?status=under_review', { token }),
      undefined,
    );
    expect(((await waiting.json()).data as unknown[]).length).toBe(0);
  });

  it('refuses a paper filed against somebody else’s purchase', async () => {
    const other = await db.customer.create({
      data: { code: 'CUST-2026-002', name: 'Another Investor', phone: '01811999999' },
    });
    const form = new FormData();
    form.set('customer_id', other.id);
    form.set('sale_id', saleId);
    form.set('kind', 'signed_copy');
    form.set('title', 'Signed agreement');
    form.set('file', new File([new Uint8Array(PNG)], 'a.png', { type: 'image/png' }));

    const response = await createUpload(
      req('POST', '/api/v1/customer-uploads', { form, token }),
      undefined,
    );
    expect(response.status).toBe(422);
  });

  /* ------------------------------------------------------- the slip */

  async function submit(body: Record<string, unknown> = {}) {
    const response = await createSubmission(
      req('POST', '/api/v1/payment-submissions', {
        token,
        body: {
          customer_id: customerId,
          sale_id: saleId,
          amount: 200_000,
          method: 'bank_deposit',
          paid_on: `${YEAR}-01-05`,
          reference: 'TRX-55512',
          ...body,
        },
      }),
      undefined,
    );
    return { response, body: (await response.json()) as { data: Record<string, unknown> } };
  }

  it('books a confirmed slip on the day of the slip, not the day it was confirmed', async () => {
    const made = await submit();
    expect(made.response.status).toBe(201);
    const submission = made.body.data;
    expect(submission).toMatchObject({
      code: `PSB-${YEAR}-001`,
      status: 'submitted',
      payment_id: null,
      receipt_no: null,
    });

    /* a claim is not money: nothing has been booked against the purchase */
    expect(await db.sharePayment.count({ where: { sale_id: saleId } })).toBe(0);

    const confirmed = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${submission.id}`, {
        token,
        body: { action: 'confirm' },
      }),
      ctx(submission.id as string),
    );
    expect(confirmed.status).toBe(200);
    const after = (await confirmed.json()).data as {
      status: string;
      payment_id: string;
      receipt_no: string;
    };
    expect(after.status).toBe('confirmed');
    expect(after.receipt_no).toMatch(/^SRC-/);

    const payment = await db.sharePayment.findUniqueOrThrow({ where: { id: after.payment_id } });
    /* the whole point: the slip's date, not today */
    expect(payment.paid_on.toISOString().slice(0, 10)).toBe(`${YEAR}-01-05`);
    expect(payment.principal.toNumber()).toBe(200_000);
    expect(payment.channel).toBe('online');
    expect(payment.reference).toBe('TRX-55512');

    /* and it paid the down payment, through the ordinary ledger */
    const down = await db.shareInstallment.findFirstOrThrow({ where: { sale_id: saleId, seq: 0 } });
    const allocated = await db.sharePaymentAllocation.aggregate({
      where: { installment_id: down.id },
      _sum: { principal: true },
    });
    expect(allocated._sum.principal?.toNumber()).toBe(200_000);

    /* confirming twice would book the money twice */
    const again = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${submission.id}`, {
        token,
        body: { action: 'confirm' },
      }),
      ctx(submission.id as string),
    );
    expect(again.status).toBe(409);
  });

  it('lets Accounts correct the amount against the statement', async () => {
    const { body } = await submit({ amount: 250_000 });
    const confirmed = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${body.data.id}`, {
        token,
        body: { action: 'confirm', amount: 200_000, paid_on: `${YEAR}-01-06` },
      }),
      ctx(body.data.id as string),
    );
    expect(confirmed.status).toBe(200);
    const after = (await confirmed.json()).data as { amount: number; paid_on: string };
    expect(after).toMatchObject({ amount: 200_000, paid_on: `${YEAR}-01-06` });
  });

  it('sends a slip back with a reason, and will not un-say a confirmed one', async () => {
    const { body } = await submit();
    const noReason = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${body.data.id}`, {
        token,
        body: { action: 'reject' },
      }),
      ctx(body.data.id as string),
    );
    expect(noReason.status).toBe(422);

    const rejected = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${body.data.id}`, {
        token,
        body: { action: 'reject', review_note: 'Not on the statement for that date' },
      }),
      ctx(body.data.id as string),
    );
    expect(rejected.status).toBe(200);
    expect(await db.sharePayment.count({ where: { sale_id: saleId } })).toBe(0);

    const second = await submit({ reference: 'TRX-55513' });
    await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${second.body.data.id}`, {
        token,
        body: { action: 'confirm' },
      }),
      ctx(second.body.data.id as string),
    );
    /* money that was booked is corrected by a reversal, never by a rejection */
    const tooLate = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${second.body.data.id}`, {
        token,
        body: { action: 'reject', review_note: 'changed my mind' },
      }),
      ctx(second.body.data.id as string),
    );
    expect(tooLate.status).toBe(409);
  });

  it('keeps the desks apart: sales works requests, Accounts confirms money', async () => {
    const { body } = await submit();

    /* the sales desk can see a slip is waiting... */
    const seen = await listSubmissions(
      req('GET', '/api/v1/payment-submissions?status=submitted', { token: salesToken }),
      undefined,
    );
    expect(seen.status).toBe(200);
    expect(((await seen.json()).data as unknown[]).length).toBe(1);

    /* ...but confirming it is money, and that is not their desk */
    const refused = await reviewSubmission(
      req('PATCH', `/api/v1/payment-submissions/${body.data.id}`, {
        token: salesToken,
        body: { action: 'confirm' },
      }),
      ctx(body.data.id as string),
    );
    expect(refused.status).toBe(403);
  });

  it('counts what is waiting, for the top of the screen', async () => {
    await createRequest(
      req('POST', '/api/v1/share-requests', {
        token,
        body: { offering_id: offeringId, customer_id: customerId, shares: 3 },
      }),
      undefined,
    );
    const paper = new FormData();
    paper.set('customer_id', customerId);
    paper.set('kind', 'tin');
    paper.set('title', 'e-TIN');
    paper.set('source', 'customer');
    paper.set('file', new File([new Uint8Array(PNG)], 'tin.png', { type: 'image/png' }));
    await createUpload(req('POST', '/api/v1/customer-uploads', { form: paper, token }), undefined);
    await submit({ amount: 150_000, reference: 'TRX-9' });

    const response = await listSubmissions(
      req('GET', '/api/v1/payment-submissions?counts=true', { token }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      requests_new: 1,
      requests_value: 1_500_000,
      uploads_waiting: 1,
      submissions_waiting: 1,
      submissions_value: 150_000,
    });

    const rows = await listRequests(req('GET', '/api/v1/share-requests?status=new', { token }), undefined);
    expect(((await rows.json()).data as unknown[]).length).toBe(1);
  });
});
