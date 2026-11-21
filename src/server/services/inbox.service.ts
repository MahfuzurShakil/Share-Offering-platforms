import { Prisma } from '@prisma/client';
import { currentActorId } from '../audit/audit';
import { assertWithinScope, type StaffPrincipal } from '../auth/rbac';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';
import { putFile, readStoredFile, removeStoredFile } from '../storage/storage';
import { recordPaymentReturning, reserveShares, type ShareSaleDto } from './share-sale.service';
import { today } from './share-offering.service';
import { rejectUploadOf } from '@/lib/domain/file-upload';

/**
 * The portal inbox — the one half of this product where the customer writes
 * first (BUYER-PORTAL-PLAN.md §6, SHARE-SALE-FEEDBACK-PLAN.md part C).
 *
 * Three queues, and one rule they share: **nothing a customer sends in is a
 * record of anything until the office acts on it.** A request holds no shares
 * until somebody reserves them, an uploaded paper is on file but not accepted,
 * and a payment submission is not a payment. That is why these are their own
 * tables rather than draft rows in `share_sales` and `share_payments`: a
 * claim and the company's books must not be the same row.
 *
 * The one piece of real arithmetic here is confirming a submission, and it
 * does not do it: it calls `recordPayment` with the **date on the slip**, so
 * the ledger, the schedule and the late fees see the money on the day it
 * arrived rather than the day Accounts got to it.
 */

/**
 * What a slip's method is, said in the ledger's own vocabulary.
 *
 * `share_payments.method` is the closed set the receipts and the reports are
 * written in; what a customer picks on the portal is finer than that. The
 * exact one is kept on the receipt as `method_detail`, so "pay order" is not
 * lost by being booked as a cheque.
 */
const LEDGER_METHOD: Record<string, string> = {
  bank_deposit: 'bank_transfer',
  bank_transfer: 'bank_transfer',
  cheque_deposit: 'cheque',
  pay_order: 'cheque',
};

const num = (d: Prisma.Decimal) => d.toNumber();
const day = (d: Date) => d.toISOString().slice(0, 10);
const dayOrNull = (d: Date | null) => (d === null ? null : day(d));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/* ------------------------------------------------------------------ *
 * Requests to buy
 * ------------------------------------------------------------------ */

const REQUEST_SELECT = {
  id: true,
  code: true,
  offering_id: true,
  project_id: true,
  customer_id: true,
  source: true,
  prospect_name: true,
  prospect_phone: true,
  prospect_email: true,
  shares: true,
  installments: true,
  note: true,
  requested_at: true,
  status: true,
  sale_id: true,
  office_note: true,
  created_at: true,
  updated_at: true,
  customer: { select: { id: true, code: true, name: true, phone: true } },
  project: { select: { id: true, name: true } },
  offering: { select: { id: true, code: true, round_no: true, price_per_share: true, status: true } },
  sale: { select: { id: true, code: true, status: true } },
} satisfies Prisma.ShareRequestSelect;

type RequestRow = Prisma.ShareRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

export interface ShareRequestDto {
  id: string;
  code: string;
  offering_id: string;
  offering_code: string;
  offering_round: number;
  offering_status: string;
  price_per_share: number;
  project_id: string;
  project_name: string;
  /** null for a website visitor — there is no customer until one is made */
  customer_id: string | null;
  customer_code: string | null;
  /** the customer's name, or the visitor's as they typed it */
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  shares: number;
  installments: number;
  note: string | null;
  requested_at: string;
  status: string;
  sale_id: string | null;
  sale_code: string | null;
  office_note: string | null;
  /** what it would cost at the round's price, so a list can be read at a glance */
  value: number;
  created_at: string;
  updated_at: string;
}

function toRequestDto(row: RequestRow): ShareRequestDto {
  return {
    id: row.id,
    code: row.code,
    offering_id: row.offering_id,
    offering_code: row.offering.code,
    offering_round: row.offering.round_no,
    offering_status: row.offering.status,
    price_per_share: num(row.offering.price_per_share),
    project_id: row.project_id,
    project_name: row.project.name,
    customer_id: row.customer_id,
    customer_code: row.customer?.code ?? null,
    name: row.customer?.name ?? row.prospect_name ?? 'Unnamed',
    phone: row.customer?.phone ?? row.prospect_phone ?? null,
    email: row.prospect_email,
    source: row.source,
    shares: row.shares,
    installments: row.installments,
    note: row.note,
    requested_at: row.requested_at.toISOString(),
    status: row.status,
    sale_id: row.sale_id,
    sale_code: row.sale?.code ?? null,
    office_note: row.office_note,
    value: row.shares * num(row.offering.price_per_share),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export interface RequestFilters {
  status?: string;
  offering_id?: string;
  customer_id?: string;
}

export async function listRequests(
  principal: StaffPrincipal,
  filters: RequestFilters = {},
): Promise<ShareRequestDto[]> {
  const where: Prisma.ShareRequestWhereInput = { deleted_at: null };
  if (principal.project_ids.length > 0) where.project_id = { in: principal.project_ids };
  if (filters.status) where.status = filters.status as Prisma.ShareRequestWhereInput['status'];
  if (filters.offering_id) where.offering_id = filters.offering_id;
  if (filters.customer_id) where.customer_id = filters.customer_id;

  const rows = await prisma.shareRequest.findMany({
    where,
    select: REQUEST_SELECT,
    orderBy: [{ requested_at: 'desc' }],
  });
  return rows.map(toRequestDto);
}

export interface RequestInput {
  offering_id: string;
  /** a signed-in investor's own request */
  customer_id?: string | null;
  /** a website visitor's details, when there is no customer yet */
  prospect_name?: string | null;
  prospect_phone?: string | null;
  prospect_email?: string | null;
  shares: number;
  installments?: number;
  note?: string | null;
  source?: 'portal' | 'website';
}

/**
 * Takes a request in.
 *
 * It is deliberately lenient about the round's own limits: a customer asking
 * for more shares than the round allows is a conversation for the office to
 * have, not an error to throw at somebody filling in a form on a phone. What
 * it does refuse is a round that is not on the market, because then there is
 * nothing to ask for.
 */
export async function createRequest(input: RequestInput): Promise<ShareRequestDto> {
  if (!(input.shares > 0)) {
    throw invalid('How many shares?', { shares: 'At least one.' });
  }
  if (!input.customer_id && !input.prospect_phone?.trim()) {
    throw invalid('A number to call back on is needed.', {
      prospect_phone: 'Required when there is no customer on file.',
    });
  }

  const row = await withTx(async (tx: Tx) => {
    const offering = await tx.shareOffering.findUnique({
      where: { id: input.offering_id },
      select: { id: true, project_id: true, status: true },
    });
    if (!offering) throw notFound('That share offering');
    if (offering.status !== 'open') {
      throw conflict('That round is not open for requests.');
    }

    return tx.shareRequest.create({
      select: REQUEST_SELECT,
      data: {
        code: await nextCode(tx, 'share_request'),
        offering_id: offering.id,
        project_id: offering.project_id,
        customer_id: input.customer_id ?? null,
        source: input.source ?? 'portal',
        prospect_name: input.customer_id ? null : (input.prospect_name?.trim() ?? null),
        prospect_phone: input.customer_id ? null : (input.prospect_phone?.trim() ?? null),
        prospect_email: input.customer_id ? null : (input.prospect_email?.trim() ?? null),
        shares: Math.round(input.shares),
        installments: Math.max(0, Math.round(input.installments ?? 0)),
        note: input.note?.trim() || null,
        created_by: currentActorId(),
      },
    });
  });
  return toRequestDto(row);
}

/** A note from the office: who called, what was said, or why it was declined. */
export async function moveRequest(
  principal: StaffPrincipal,
  id: string,
  action: 'contacted' | 'declined' | 'reopen',
  officeNote?: string | null,
): Promise<ShareRequestDto> {
  const row = await withTx(async (tx: Tx) => {
    const request = await tx.shareRequest.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, project_id: true, status: true, code: true },
    });
    if (!request) throw notFound('That request');
    assertWithinScope(principal, request.project_id);
    if (request.status === 'reserved') {
      throw conflict(`${request.code} has already been turned into a reservation.`);
    }

    const status = action === 'reopen' ? 'new' : action;
    return tx.shareRequest.update({
      where: { id },
      select: REQUEST_SELECT,
      data: {
        status,
        office_note: officeNote?.trim() || null,
      },
    });
  });
  return toRequestDto(row);
}

/**
 * The step that matters: the request becomes a real reservation.
 *
 * The shares are held by `reserveShares`, which is the one place that checks
 * the round's limits and what is left of it — a request is not allowed a
 * shortcut past them. The request then points at the purchase, so the office
 * can see what became of it and the customer is not asked twice.
 */
export async function reserveFromRequest(
  principal: StaffPrincipal,
  id: string,
  input: { customer_id?: string; shares?: number; down_payment_pct: number; installment_count: number; sold_by_member_id?: string | null },
): Promise<{ request: ShareRequestDto; sale: ShareSaleDto }> {
  const request = await prisma.shareRequest.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, code: true, project_id: true, offering_id: true, customer_id: true, shares: true, status: true },
  });
  if (!request) throw notFound('That request');
  assertWithinScope(principal, request.project_id);
  if (request.status === 'reserved') {
    throw conflict(`${request.code} has already been turned into a reservation.`);
  }
  if (request.status === 'withdrawn' || request.status === 'declined') {
    throw conflict(`${request.code} was closed. Reopen it first.`);
  }

  const customerId = input.customer_id ?? request.customer_id;
  if (!customerId) {
    throw invalid('This request came from the website, so an investor file is needed first.', {
      customer_id: 'Create or pick the investor.',
    });
  }

  const sale = await reserveShares(principal, {
    offering_id: request.offering_id,
    customer_id: customerId,
    shares: input.shares ?? request.shares,
    down_payment_pct: input.down_payment_pct,
    installment_count: input.installment_count,
    sold_by_member_id: input.sold_by_member_id ?? null,
  });

  const row = await prisma.shareRequest.update({
    where: { id },
    select: REQUEST_SELECT,
    data: { status: 'reserved', sale_id: sale.id, customer_id: customerId },
  });
  return { request: toRequestDto(row), sale };
}

/* ------------------------------------------------------------------ *
 * Papers a customer sends in
 * ------------------------------------------------------------------ */

const UPLOAD_SELECT = {
  id: true,
  customer_id: true,
  sale_id: true,
  source: true,
  kind: true,
  title: true,
  note: true,
  file_name: true,
  file_type: true,
  file_size: true,
  uploaded_at: true,
  status: true,
  reviewed_by: true,
  reviewed_on: true,
  review_note: true,
  customer: { select: { id: true, code: true, name: true, phone: true } },
  sale: { select: { id: true, code: true, project: { select: { name: true } } } },
} satisfies Prisma.CustomerUploadSelect;

type UploadRow = Prisma.CustomerUploadGetPayload<{ select: typeof UPLOAD_SELECT }>;

export interface CustomerUploadDto {
  id: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  /** null for the customer's own papers, which serve every purchase */
  sale_id: string | null;
  sale_code: string | null;
  project_name: string | null;
  source: string;
  kind: string;
  title: string;
  note: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
  status: string;
  reviewed_on: string | null;
  review_note: string | null;
}

function toUploadDto(row: UploadRow): CustomerUploadDto {
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_code: row.customer.code,
    customer_name: row.customer.name,
    customer_phone: row.customer.phone,
    sale_id: row.sale_id,
    sale_code: row.sale?.code ?? null,
    project_name: row.sale?.project.name ?? null,
    source: row.source,
    kind: row.kind,
    title: row.title,
    note: row.note,
    file_name: row.file_name,
    file_type: row.file_type,
    file_size: row.file_size,
    uploaded_at: row.uploaded_at.toISOString(),
    status: row.status,
    reviewed_on: dayOrNull(row.reviewed_on),
    review_note: row.review_note,
  };
}

export interface UploadFilters {
  status?: string;
  customer_id?: string;
  sale_id?: string;
}

export async function listUploads(filters: UploadFilters = {}): Promise<CustomerUploadDto[]> {
  const rows = await prisma.customerUpload.findMany({
    where: {
      deleted_at: null,
      ...(filters.status ? { status: filters.status as Prisma.CustomerUploadWhereInput['status'] } : {}),
      ...(filters.customer_id ? { customer_id: filters.customer_id } : {}),
      ...(filters.sale_id ? { sale_id: filters.sale_id } : {}),
    },
    select: UPLOAD_SELECT,
    orderBy: [{ uploaded_at: 'desc' }],
  });
  return rows.map(toUploadDto);
}

export interface UploadInput {
  customer_id: string;
  sale_id?: string | null;
  kind: string;
  title: string;
  note?: string | null;
  source?: 'customer' | 'office';
}

/**
 * Puts a file on a customer's record.
 *
 * A paper the **office** uploads is accepted as it lands — somebody who can
 * see the record put it there. One a customer sends in waits for review, which
 * is the whole reason this queue exists.
 */
export async function createUpload(
  input: UploadInput,
  file: { name: string; type: string; bytes: Buffer },
): Promise<CustomerUploadDto> {
  if (!input.title.trim()) throw invalid('Give the paper a name.', { title: 'Required.' });
  if (file.bytes.byteLength === 0) throw invalid('That file is empty.', { file: 'Empty file.' });
  const rejected = rejectUploadOf(file.name, file.type, file.bytes.byteLength);
  if (rejected) throw invalid(rejected, { file: rejected });

  const customer = await prisma.customer.findFirst({
    where: { id: input.customer_id },
    select: { id: true },
  });
  if (!customer) throw notFound('That customer');

  if (input.sale_id) {
    const sale = await prisma.shareSale.findFirst({
      where: { id: input.sale_id, customer_id: input.customer_id },
      select: { id: true },
    });
    if (!sale) throw invalid('That purchase does not belong to this customer.');
  }

  const stored = await putFile('customer-uploads', file);
  const byOffice = input.source !== 'customer';

  try {
    const row = await prisma.customerUpload.create({
      select: UPLOAD_SELECT,
      data: {
        customer_id: input.customer_id,
        sale_id: input.sale_id ?? null,
        source: byOffice ? 'office' : 'customer',
        kind: input.kind as Prisma.CustomerUploadCreateInput['kind'],
        title: input.title.trim(),
        note: input.note?.trim() || null,
        storage_key: stored.storage_key,
        file_name: stored.file_name,
        file_type: stored.mime_type,
        file_size: stored.file_size,
        status: byOffice ? 'accepted' : 'under_review',
        reviewed_by: byOffice ? currentActorId() : null,
        reviewed_on: byOffice ? toDate(today()) : null,
        created_by: currentActorId(),
      },
    });
    return toUploadDto(row);
  } catch (error) {
    await removeStoredFile(stored.storage_key);
    throw error;
  }
}

/** Accepting or turning down a paper. A rejection is written for the customer. */
export async function reviewUpload(
  id: string,
  action: 'accept' | 'reject',
  reviewNote?: string | null,
): Promise<CustomerUploadDto> {
  const upload = await prisma.customerUpload.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, status: true },
  });
  if (!upload) throw notFound('That upload');
  if (action === 'reject' && !reviewNote?.trim()) {
    throw invalid('Say why, so the customer knows what to send instead.', {
      review_note: 'Required.',
    });
  }

  const row = await prisma.customerUpload.update({
    where: { id },
    select: UPLOAD_SELECT,
    data: {
      status: action === 'accept' ? 'accepted' : 'rejected',
      review_note: action === 'reject' ? reviewNote!.trim() : null,
      reviewed_by: currentActorId(),
      reviewed_on: toDate(today()),
    },
  });
  return toUploadDto(row);
}

/** The bytes, for the route that serves them. */
export async function readUploadFile(
  id: string,
): Promise<{ bytes: Buffer; mime: string; name: string; customer_id: string }> {
  const row = await prisma.customerUpload.findFirst({
    where: { id, deleted_at: null },
    select: { storage_key: true, file_type: true, file_name: true, customer_id: true },
  });
  if (!row) throw notFound('That upload');
  const bytes = await readStoredFile(row.storage_key);
  if (!bytes) throw notFound('The file for that upload');
  return {
    bytes,
    mime: row.file_type || 'application/octet-stream',
    name: row.file_name,
    customer_id: row.customer_id,
  };
}

/* ------------------------------------------------------------------ *
 * "I paid at the bank"
 * ------------------------------------------------------------------ */

const SUBMISSION_SELECT = {
  id: true,
  code: true,
  customer_id: true,
  sale_id: true,
  amount: true,
  method: true,
  paid_on: true,
  paid_into_account_id: true,
  reference: true,
  note: true,
  slip_upload_id: true,
  status: true,
  reviewed_at: true,
  review_note: true,
  payment_id: true,
  created_at: true,
  customer: { select: { id: true, code: true, name: true, phone: true } },
  sale: { select: { id: true, code: true, project_id: true, project: { select: { name: true } } } },
  account: { select: { id: true, name: true } },
  payment: { select: { id: true, code: true } },
} satisfies Prisma.PaymentSubmissionSelect;

type SubmissionRow = Prisma.PaymentSubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;

export interface PaymentSubmissionDto {
  id: string;
  code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  sale_id: string;
  sale_code: string;
  project_name: string;
  amount: number;
  method: string;
  paid_on: string;
  paid_into_account_id: string | null;
  account_name: string | null;
  reference: string;
  note: string | null;
  slip_upload_id: string | null;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
  /** the receipt its confirmation wrote */
  payment_id: string | null;
  receipt_no: string | null;
  created_at: string;
}

function toSubmissionDto(row: SubmissionRow): PaymentSubmissionDto {
  return {
    id: row.id,
    code: row.code,
    customer_id: row.customer_id,
    customer_code: row.customer.code,
    customer_name: row.customer.name,
    customer_phone: row.customer.phone,
    sale_id: row.sale_id,
    sale_code: row.sale.code,
    project_name: row.sale.project.name,
    amount: num(row.amount),
    method: row.method,
    paid_on: day(row.paid_on),
    paid_into_account_id: row.paid_into_account_id,
    account_name: row.account?.name ?? null,
    reference: row.reference,
    note: row.note,
    slip_upload_id: row.slip_upload_id,
    status: row.status,
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
    review_note: row.review_note,
    payment_id: row.payment_id,
    receipt_no: row.payment?.code ?? null,
    created_at: row.created_at.toISOString(),
  };
}

export interface SubmissionFilters {
  status?: string;
  customer_id?: string;
  sale_id?: string;
}

export async function listSubmissions(
  principal: StaffPrincipal,
  filters: SubmissionFilters = {},
): Promise<PaymentSubmissionDto[]> {
  const where: Prisma.PaymentSubmissionWhereInput = { deleted_at: null };
  if (principal.project_ids.length > 0) {
    where.sale = { project_id: { in: principal.project_ids } };
  }
  if (filters.status) where.status = filters.status as Prisma.PaymentSubmissionWhereInput['status'];
  if (filters.customer_id) where.customer_id = filters.customer_id;
  if (filters.sale_id) where.sale_id = filters.sale_id;

  const rows = await prisma.paymentSubmission.findMany({
    where,
    select: SUBMISSION_SELECT,
    orderBy: [{ created_at: 'desc' }],
  });
  return rows.map(toSubmissionDto);
}

export interface SubmissionInput {
  sale_id: string;
  amount: number;
  method: string;
  paid_on: string;
  reference: string;
  paid_into_account_id?: string | null;
  note?: string | null;
  slip_upload_id?: string | null;
}

/**
 * A customer says money went in. Nothing is paid yet.
 *
 * The amount and the date are taken as *claimed* and checked only for the
 * obvious: a date in the future cannot be on a slip, and a reference is what
 * Accounts will match against the statement. Whether the money really arrived
 * is the bank's answer, not this function's.
 */
export async function createSubmission(
  customerId: string,
  input: SubmissionInput,
): Promise<PaymentSubmissionDto> {
  if (!(input.amount > 0)) throw invalid('How much?', { amount: 'More than ৳0.' });
  if (!input.reference.trim()) {
    throw invalid('The slip or transaction number is what the bank is matched on.', {
      reference: 'Required.',
    });
  }
  if (input.paid_on > today()) {
    throw invalid('A slip cannot be dated in the future.', { paid_on: 'Today or earlier.' });
  }

  const row = await withTx(async (tx: Tx) => {
    const sale = await tx.shareSale.findFirst({
      where: { id: input.sale_id, customer_id: customerId, deleted_at: null },
      select: { id: true, status: true, code: true },
    });
    if (!sale) throw notFound('That purchase');
    if (sale.status !== 'agreement_signed' && sale.status !== 'fully_paid') {
      throw conflict(`${sale.code} is not signed yet, so there is nothing to pay against it.`);
    }

    return tx.paymentSubmission.create({
      select: SUBMISSION_SELECT,
      data: {
        code: await nextCode(tx, 'payment_submission'),
        customer_id: customerId,
        sale_id: sale.id,
        amount: new Prisma.Decimal(Math.round(input.amount)),
        method: input.method as Prisma.PaymentSubmissionCreateInput['method'],
        paid_on: toDate(input.paid_on),
        paid_into_account_id: input.paid_into_account_id ?? null,
        reference: input.reference.trim(),
        note: input.note?.trim() || null,
        slip_upload_id: input.slip_upload_id ?? null,
        created_by: currentActorId(),
      },
    });
  });
  return toSubmissionDto(row);
}

/**
 * Accounts has found it on the statement: write the payment.
 *
 * Dated the day on the slip, not today — that is the point of the whole queue.
 * Everything else about the money (late fees first, oldest row first, paid-off
 * status) is `recordPayment`'s job, so a confirmed submission behaves exactly
 * like a receipt typed at the counter, because it *is* one.
 *
 * `amount` and `paid_on` can be corrected here: the slip is what the bank
 * shows, and Accounts is the one reading it.
 */
export async function confirmSubmission(
  principal: StaffPrincipal,
  id: string,
  input: { amount?: number; paid_on?: string; account_id?: string | null; note?: string | null } = {},
): Promise<PaymentSubmissionDto> {
  const submission = await prisma.paymentSubmission.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true,
      code: true,
      status: true,
      sale_id: true,
      amount: true,
      method: true,
      paid_on: true,
      reference: true,
      paid_into_account_id: true,
      sale: { select: { project_id: true } },
    },
  });
  if (!submission) throw notFound('That submission');
  assertWithinScope(principal, submission.sale.project_id);
  if (submission.status === 'confirmed') {
    throw conflict(`${submission.code} has already been confirmed.`);
  }
  if (submission.status === 'withdrawn') {
    throw conflict(`${submission.code} was withdrawn by the customer.`);
  }

  const amount = input.amount ?? num(submission.amount);
  const paidOn = input.paid_on ?? day(submission.paid_on);
  const accountId = input.account_id ?? submission.paid_into_account_id;

  const { payment_id } = await recordPaymentReturning(principal, submission.sale_id, {
    paid_on: paidOn,
    amount,
    method: LEDGER_METHOD[submission.method] ?? 'bank_transfer',
    reference: submission.reference,
    notes: input.note?.trim() || null,
    /* it came in from the portal, and the receipt should say so */
    channel: 'online',
    method_detail: submission.method,
    account_id: accountId,
  });

  const row = await prisma.paymentSubmission.update({
    where: { id },
    select: SUBMISSION_SELECT,
    data: {
      status: 'confirmed',
      amount: new Prisma.Decimal(Math.round(amount)),
      paid_on: toDate(paidOn),
      paid_into_account_id: accountId,
      payment_id,
      reviewed_by: currentActorId(),
      reviewed_at: new Date(),
      review_note: null,
    },
  });
  return toSubmissionDto(row);
}

/** Not on the statement, or the slip does not match: sent back with a reason. */
export async function rejectSubmission(
  principal: StaffPrincipal,
  id: string,
  reason: string,
): Promise<PaymentSubmissionDto> {
  if (!reason.trim()) {
    throw invalid('Say why, so the customer can send the right slip.', {
      review_note: 'Required.',
    });
  }
  const submission = await prisma.paymentSubmission.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, code: true, status: true, sale: { select: { project_id: true } } },
  });
  if (!submission) throw notFound('That submission');
  assertWithinScope(principal, submission.sale.project_id);
  if (submission.status === 'confirmed') {
    throw conflict(
      `${submission.code} is already a receipt. Reverse the receipt instead — money that was booked is corrected, not un-said.`,
    );
  }

  const row = await prisma.paymentSubmission.update({
    where: { id },
    select: SUBMISSION_SELECT,
    data: {
      status: 'rejected',
      review_note: reason.trim(),
      reviewed_by: currentActorId(),
      reviewed_at: new Date(),
    },
  });
  return toSubmissionDto(row);
}

/* ------------------------------------------------------------------ *
 * What is waiting
 * ------------------------------------------------------------------ */

export interface InboxCounts {
  requests_new: number;
  requests_value: number;
  uploads_waiting: number;
  submissions_waiting: number;
  submissions_value: number;
}

/** The four numbers across the top of the Customer Requests screen. */
export async function inboxCounts(principal: StaffPrincipal): Promise<InboxCounts> {
  const scope =
    principal.project_ids.length > 0 ? { in: principal.project_ids } : undefined;

  type RequestCount = { shares: number; offering: { price_per_share: Prisma.Decimal } };
  type SubmissionCount = { amount: Prisma.Decimal };

  const [requests, uploads, submissions] = await Promise.all([
    prisma.shareRequest.findMany({
      where: {
        deleted_at: null,
        status: { in: ['new', 'contacted'] },
        ...(scope ? { project_id: scope } : {}),
      },
      select: { shares: true, offering: { select: { price_per_share: true } } },
    }) as Promise<RequestCount[]>,
    prisma.customerUpload.count({ where: { deleted_at: null, status: 'under_review' } }),
    prisma.paymentSubmission.findMany({
      where: {
        deleted_at: null,
        status: 'submitted',
        ...(scope ? { sale: { project_id: scope } } : {}),
      },
      select: { amount: true },
    }) as Promise<SubmissionCount[]>,
  ]);

  return {
    requests_new: requests.length,
    requests_value: requests.reduce(
      (total, r) => total + r.shares * num(r.offering.price_per_share),
      0,
    ),
    uploads_waiting: uploads,
    submissions_waiting: submissions.length,
    submissions_value: submissions.reduce((total, s) => total + num(s.amount), 0),
  };
}
