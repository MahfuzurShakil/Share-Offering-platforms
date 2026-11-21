import { Prisma } from '@prisma/client';
import { addMonths } from '@/lib/domain/money';
import {
  allocateSharePayment,
  buildSchedule,
  maxSharePayable,
  offeringFeeRule,
  offeringState,
  viewSale,
  type SaleView,
} from '@/lib/domain/share-sale';
import type {
  ShareInstallment,
  SharePayment,
  ShareOffering,
  ShareSale,
} from '@/lib/db/types';
import { currentActorId } from '../audit/audit';
import { assertWithinScope, type StaffPrincipal } from '../auth/rbac';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';
import { today } from './share-offering.service';

/**
 * A share purchase, from the hold to the last receipt.
 *
 * The story (PROJECT-SHARE-SALE-PLAN.md §4, steps 3–8): shares are *reserved*
 * for a customer while the agreement is prepared; signing the agreement fixes
 * the plan and writes the payment schedule; money comes in against that
 * schedule until it is paid off.
 *
 * The money maths is not here. `lib/domain/share-sale.ts` builds the schedule,
 * says what each installment is owed and how a payment is spread over it, and
 * the browser runs the same code to show it — so what the screen says and what
 * the server books can never drift (AGENTS.md). This file is the rules about
 * *when* those sums may be done: who may hold shares, what a signing requires,
 * and that a receipt is never edited.
 */

/* ------------------------------------------------------------------ *
 * Reading, and the shape the domain wants
 * ------------------------------------------------------------------ */

const SALE_SELECT = {
  id: true,
  code: true,
  offering_id: true,
  project_id: true,
  customer_id: true,
  shares: true,
  share_pct: true,
  price_per_share: true,
  total_price: true,
  down_payment: true,
  installment_count: true,
  installment_frequency: true,
  reserved_on: true,
  hold_until: true,
  agreement_no: true,
  agreement_date: true,
  first_due_date: true,
  certificate_no: true,
  certificate_date: true,
  status: true,
  status_note: true,
  notes: true,
  signing: true,
  sold_by_member_id: true,
  created_at: true,
  updated_at: true,
  customer: { select: { id: true, code: true, name: true, phone: true } },
  project: { select: { id: true, code: true, name: true } },
  offering: {
    select: {
      id: true,
      code: true,
      round_no: true,
      status: true,
      closes_on: true,
      min_shares: true,
      max_shares: true,
      min_down_payment_pct: true,
      max_installments: true,
      installment_frequency: true,
      late_fee_type: true,
      late_fee_pct: true,
      late_fee_amount: true,
      grace_days: true,
      hold_days: true,
      price_per_share: true,
      share_pct: true,
      total_shares: true,
    },
  },
} satisfies Prisma.ShareSaleSelect;

type SaleRow = Prisma.ShareSaleGetPayload<{ select: typeof SALE_SELECT }>;

const num = (d: Prisma.Decimal) => d.toNumber();
const numOrNull = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const day = (d: Date) => d.toISOString().slice(0, 10);
const dayOrNull = (d: Date | null) => (d === null ? null : day(d));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Prisma rows in the shape `lib/domain` reads: money as numbers, dates as
 * `YYYY-MM-DD`. One place, so every sum downstream sees the same thing.
 */
function asDomainSale(row: SaleRow): ShareSale {
  return {
    id: row.id,
    code: row.code,
    offering_id: row.offering_id,
    project_id: row.project_id,
    customer_id: row.customer_id,
    shares: row.shares,
    share_pct: num(row.share_pct),
    price_per_share: num(row.price_per_share),
    total_price: num(row.total_price),
    down_payment: num(row.down_payment),
    installment_count: row.installment_count,
    installment_frequency: row.installment_frequency,
    reserved_on: day(row.reserved_on),
    hold_until: day(row.hold_until),
    agreement_no: row.agreement_no,
    agreement_date: dayOrNull(row.agreement_date),
    first_due_date: dayOrNull(row.first_due_date),
    certificate_no: row.certificate_no,
    certificate_date: dayOrNull(row.certificate_date),
    status: row.status,
    status_note: row.status_note,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    created_by: null,
  } as unknown as ShareSale;
}

interface InstallmentRow {
  id: string;
  sale_id: string;
  seq: number;
  due_date: Date;
  amount: Prisma.Decimal;
}

interface PaymentRow {
  id: string;
  code: string;
  sale_id: string;
  paid_on: Date;
  amount: Prisma.Decimal;
  principal: Prisma.Decimal;
  late_fee: Prisma.Decimal;
  method: string;
  reference: string | null;
  notes: string | null;
  channel: string;
  method_detail: string | null;
  account_id: string | null;
  reverses_payment_id: string | null;
  created_at: Date;
  allocations: { installment_id: string; principal: Prisma.Decimal; late_fee: Prisma.Decimal }[];
}

const asDomainInstallment = (row: InstallmentRow): ShareInstallment =>
  ({
    id: row.id,
    sale_id: row.sale_id,
    seq: row.seq,
    due_date: day(row.due_date),
    amount: num(row.amount),
  }) as unknown as ShareInstallment;

const asDomainPayment = (row: PaymentRow): SharePayment =>
  ({
    id: row.id,
    code: row.code,
    sale_id: row.sale_id,
    paid_on: day(row.paid_on),
    amount: num(row.amount),
    principal: num(row.principal),
    late_fee: num(row.late_fee),
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    channel: row.channel,
    method_detail: row.method_detail,
    account_id: row.account_id,
    allocations: row.allocations.map((a) => ({
      installment_id: a.installment_id,
      principal: num(a.principal),
      late_fee: num(a.late_fee),
    })),
    created_at: row.created_at.toISOString(),
  }) as unknown as SharePayment;

/** The late-fee rule a purchase is held to: its round's, as it was agreed. */
function feeRuleOf(row: SaleRow) {
  return offeringFeeRule({
    late_fee_pct: num(row.offering.late_fee_pct),
    late_fee_type: row.offering.late_fee_type,
    late_fee_amount: numOrNull(row.offering.late_fee_amount),
    grace_days: row.offering.grace_days,
  } as unknown as ShareOffering);
}

async function loadSale(client: Tx, id: string): Promise<SaleRow> {
  const row = await client.shareSale.findUnique({ where: { id }, select: SALE_SELECT });
  if (!row) throw notFound('That purchase');
  return row;
}

/** One purchase as the domain sees it: schedule, receipts, what is owed. */
async function viewOf(client: Tx, row: SaleRow, asOf = today()): Promise<SaleView> {
  const [installments, payments] = await Promise.all([
    client.shareInstallment.findMany({ where: { sale_id: row.id }, orderBy: { seq: 'asc' } }),
    client.sharePayment.findMany({
      where: { sale_id: row.id },
      orderBy: { paid_on: 'asc' },
      include: { allocations: true },
    }),
  ]);
  return viewSale(
    asDomainSale(row),
    (installments as InstallmentRow[]).map(asDomainInstallment),
    (payments as PaymentRow[]).map(asDomainPayment),
    asOf,
    feeRuleOf(row),
  );
}

export interface ShareSaleDto {
  id: string;
  code: string;
  offering_id: string;
  offering_code: string;
  round_no: number;
  project_id: string;
  project_name: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  shares: number;
  share_pct: number;
  price_per_share: number;
  total_price: number;
  down_payment: number;
  installment_count: number;
  installment_frequency: string;
  reserved_on: string;
  hold_until: string;
  agreement_no: string | null;
  agreement_date: string | null;
  first_due_date: string | null;
  certificate_no: string | null;
  certificate_date: string | null;
  status: string;
  status_note: string | null;
  notes: string | null;
  signing: unknown;
  created_at: string;
  updated_at: string;

  /** everything the schedule says, worked out by `lib/domain` */
  paid: number;
  outstanding: number;
  overdue_amount: number;
  late_fees: number;
  due_now: number;
  progress_pct: number;
  paid_count: number;
  health: string;
  next_due_date: string | null;
  schedule: {
    id: string;
    seq: number;
    label: string;
    due_date: string;
    amount: number;
    paid_amount: number;
    remaining: number;
    status: string;
    days_late: number;
    late_fee_due: number;
    late_fee_paid: number;
  }[];
  payments: {
    id: string;
    code: string;
    paid_on: string;
    amount: number;
    principal: number;
    late_fee: number;
    method: string;
    reference: string | null;
    channel: string;
    notes: string | null;
    /** set on a reversing receipt */
    reverses_payment_id: string | null;
  }[];
}

function toDto(row: SaleRow, view: SaleView, payments: PaymentRow[]): ShareSaleDto {
  return {
    id: row.id,
    code: row.code,
    offering_id: row.offering_id,
    offering_code: row.offering.code,
    round_no: row.offering.round_no,
    project_id: row.project_id,
    project_name: row.project.name,
    customer_id: row.customer_id,
    customer_code: row.customer.code,
    customer_name: row.customer.name,
    customer_phone: row.customer.phone,
    shares: row.shares,
    share_pct: num(row.share_pct),
    price_per_share: num(row.price_per_share),
    total_price: num(row.total_price),
    down_payment: num(row.down_payment),
    installment_count: row.installment_count,
    installment_frequency: row.installment_frequency,
    reserved_on: day(row.reserved_on),
    hold_until: day(row.hold_until),
    agreement_no: row.agreement_no,
    agreement_date: dayOrNull(row.agreement_date),
    first_due_date: dayOrNull(row.first_due_date),
    certificate_no: row.certificate_no,
    certificate_date: dayOrNull(row.certificate_date),
    status: row.status,
    status_note: row.status_note,
    notes: row.notes,
    signing: row.signing,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),

    paid: view.paid,
    outstanding: view.outstanding,
    overdue_amount: view.overdue_amount,
    late_fees: view.late_fees,
    due_now: view.due_now,
    progress_pct: view.progress_pct,
    paid_count: view.paid_count,
    health: view.health,
    next_due_date: view.next?.due_date ?? null,
    schedule: view.schedule.map((i) => ({
      id: i.id,
      seq: i.seq,
      label: i.label,
      due_date: i.due_date,
      amount: i.amount,
      paid_amount: i.paid_amount,
      remaining: i.remaining,
      status: i.status,
      days_late: i.days_late,
      late_fee_due: i.late_fee_due,
      late_fee_paid: i.late_fee_paid,
    })),
    payments: payments
      .slice()
      .sort((a, b) => b.paid_on.getTime() - a.paid_on.getTime() || b.code.localeCompare(a.code))
      .map((p) => ({
        id: p.id,
        code: p.code,
        paid_on: day(p.paid_on),
        amount: num(p.amount),
        principal: num(p.principal),
        late_fee: num(p.late_fee),
        method: p.method,
        reference: p.reference,
        channel: p.channel,
        notes: p.notes,
        reverses_payment_id: p.reverses_payment_id,
      })),
  };
}

async function dtoOf(client: Tx, row: SaleRow, asOf = today()): Promise<ShareSaleDto> {
  const payments = (await client.sharePayment.findMany({
    where: { sale_id: row.id },
    include: { allocations: true },
  })) as PaymentRow[];
  const view = await viewOf(client, row, asOf);
  return toDto(row, view, payments);
}

/* ------------------------------------------------------------------ *
 * Listing
 * ------------------------------------------------------------------ */

export interface SaleFilters {
  offering_id?: string;
  project_id?: string;
  customer_id?: string;
  status?: string;
  search?: string;
  /** only the purchases with something overdue today */
  overdue?: boolean;
}

export interface SalePage {
  rows: ShareSaleDto[];
  total: number;
  page: number;
  page_size: number;
}

export async function listSales(
  principal: StaffPrincipal,
  filters: SaleFilters = {},
  paging: { page?: number; page_size?: number } = {},
): Promise<SalePage> {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 50));

  const where: Prisma.ShareSaleWhereInput = {};
  if (principal.project_ids.length > 0) where.project_id = { in: principal.project_ids };
  if (filters.project_id) {
    assertWithinScope(principal, filters.project_id);
    where.project_id = filters.project_id;
  }
  if (filters.offering_id) where.offering_id = filters.offering_id;
  if (filters.customer_id) where.customer_id = filters.customer_id;
  if (filters.status) where.status = filters.status as Prisma.ShareSaleWhereInput['status'];
  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { agreement_no: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
      { customer: { phone: { contains: search } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.shareSale.findMany({
      where,
      select: SALE_SELECT,
      orderBy: [{ created_at: 'desc' }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.shareSale.count({ where }),
  ]);

  /*
   * The schedule and the receipts are loaded for the page in two queries, then
   * each purchase is viewed through the domain. Not one query per row, and not
   * a sum in SQL either: what is overdue depends on the late-fee rule and the
   * day, which is the domain's to say and the browser's to repeat.
   */
  const ids = rows.map((r: SaleRow) => r.id);
  const [installments, payments] = await Promise.all([
    prisma.shareInstallment.findMany({ where: { sale_id: { in: ids } } }),
    prisma.sharePayment.findMany({ where: { sale_id: { in: ids } }, include: { allocations: true } }),
  ]);

  const asOf = today();
  const dtos: ShareSaleDto[] = rows.map((row: SaleRow) => {
    const mine = (payments as PaymentRow[]).filter((p) => p.sale_id === row.id);
    const view = viewSale(
      asDomainSale(row),
      (installments as InstallmentRow[]).filter((i) => i.sale_id === row.id).map(asDomainInstallment),
      mine.map(asDomainPayment),
      asOf,
      feeRuleOf(row),
    );
    return toDto(row, view, mine);
  });

  return {
    rows: filters.overdue ? dtos.filter((d) => d.due_now > 0.5) : dtos,
    total,
    page,
    page_size,
  };
}

export async function getSale(principal: StaffPrincipal, id: string): Promise<ShareSaleDto> {
  const row = await loadSale(prisma, id);
  assertWithinScope(principal, row.project_id);
  return dtoOf(prisma, row);
}

/* ------------------------------------------------------------------ *
 * Reserving
 * ------------------------------------------------------------------ */

export interface ReserveInput {
  offering_id: string;
  customer_id: string;
  shares: number;
  down_payment_pct: number;
  installment_count: number;
  reserved_on?: string;
  notes?: string | null;
  sold_by_member_id?: string | null;
}

interface OfferingTerms {
  min_shares: number;
  max_shares: number | null;
  min_down_payment_pct: number;
  max_installments: number;
}

/**
 * The plan a customer may take in this round: how many shares, how much down,
 * how many installments. Checked when the shares are held and again when the
 * agreement is signed, because what was agreed at the table may differ from
 * what was reserved.
 */
function checkPlan(
  terms: OfferingTerms,
  plan: { shares: number; down_payment_pct: number; installment_count: number },
): void {
  const fields: Record<string, string> = {};
  const max = terms.max_shares ?? Number.MAX_SAFE_INTEGER;

  if (!Number.isInteger(plan.shares) || plan.shares < terms.min_shares || plan.shares > max) {
    fields.shares = `Between ${terms.min_shares} and ${terms.max_shares ?? 'any number of'} shares.`;
  }
  if (!(plan.down_payment_pct >= terms.min_down_payment_pct && plan.down_payment_pct <= 100)) {
    fields.down_payment_pct = `At least ${terms.min_down_payment_pct}% of the price.`;
  }
  if (
    !Number.isInteger(plan.installment_count) ||
    plan.installment_count < 0 ||
    plan.installment_count > terms.max_installments
  ) {
    fields.installment_count = `Up to ${terms.max_installments} installments.`;
  }
  if (plan.installment_count === 0 && plan.down_payment_pct < 100) {
    fields.installment_count = 'With no installments the whole price is paid at signing.';
  }
  if (plan.installment_count > 0 && plan.down_payment_pct >= 100) {
    fields.down_payment_pct = 'A full down payment leaves nothing to pay in installments.';
  }
  if (Object.keys(fields).length > 0) {
    throw invalid('That plan does not fit this round’s terms.', fields);
  }
}

/** Shares each live purchase in this round holds, by customer and in total. */
async function heldInRound(client: Tx, offeringId: string, exceptSaleId?: string) {
  const rows = await client.shareSale.findMany({
    where: {
      offering_id: offeringId,
      deleted_at: null,
      status: { in: ['reserved', 'agreement_signed', 'fully_paid'] },
      ...(exceptSaleId ? { id: { not: exceptSaleId } } : {}),
    },
    select: { customer_id: true, shares: true },
  });
  let total = 0;
  const byCustomer = new Map<string, number>();
  for (const row of rows as { customer_id: string; shares: number }[]) {
    total += row.shares;
    byCustomer.set(row.customer_id, (byCustomer.get(row.customer_id) ?? 0) + row.shares);
  }
  return { total, byCustomer };
}

/**
 * Holds shares for a customer while the agreement is prepared (plan §4 step 3).
 *
 * The hold is what stops the same share being sold twice: it counts against
 * the round from this moment, and lapses on its own date if the agreement is
 * not signed.
 */
export async function reserveShares(
  principal: StaffPrincipal,
  input: ReserveInput,
): Promise<ShareSaleDto> {
  const row = await withTx(async (tx: Tx) => {
    const offering = await tx.shareOffering.findUnique({
      where: { id: input.offering_id },
      select: {
        id: true,
        project_id: true,
        status: true,
        closes_on: true,
        total_shares: true,
        share_pct: true,
        price_per_share: true,
        min_shares: true,
        max_shares: true,
        min_down_payment_pct: true,
        max_installments: true,
        installment_frequency: true,
        hold_days: true,
      },
    });
    if (!offering) throw notFound('That share offering');
    assertWithinScope(principal, offering.project_id);

    const reservedOn = input.reserved_on ?? today();
    const state = offeringState(
      { status: offering.status, closes_on: dayOrNull(offering.closes_on) } as ShareOffering,
      reservedOn,
    );
    if (state !== 'open') {
      throw conflict(
        state === 'expired'
          ? 'This round’s validity has ended. Extend it, or open a new round.'
          : 'Shares can only be reserved while the round is open.',
      );
    }

    const terms: OfferingTerms = {
      min_shares: offering.min_shares,
      max_shares: offering.max_shares,
      min_down_payment_pct: num(offering.min_down_payment_pct),
      max_installments: offering.max_installments,
    };
    checkPlan(terms, input);

    const customer = await tx.customer.findUnique({
      where: { id: input.customer_id },
      select: { id: true, name: true },
    });
    if (!customer) {
      throw invalid('That customer no longer exists.', { customer_id: 'Pick an investor.' });
    }

    const held = await heldInRound(tx, offering.id);
    const free = offering.total_shares - held.total;
    if (input.shares > free) {
      throw invalid(`Only ${free} share${free === 1 ? '' : 's'} are left in this round.`, {
        shares: `At most ${free}.`,
      });
    }
    const already = held.byCustomer.get(customer.id) ?? 0;
    if (terms.max_shares !== null && already + input.shares > terms.max_shares) {
      throw invalid(
        `${customer.name} already holds ${already} share${already === 1 ? '' : 's'} in this round, and the most one customer may take is ${terms.max_shares}.`,
        { shares: `At most ${Math.max(0, terms.max_shares - already)} more.` },
      );
    }

    const price = num(offering.price_per_share);
    const total = input.shares * price;

    return tx.shareSale.create({
      data: {
        code: await nextCode(tx, 'share_sale'),
        offering_id: offering.id,
        project_id: offering.project_id,
        customer_id: customer.id,
        shares: input.shares,
        share_pct: new Prisma.Decimal((input.shares * num(offering.share_pct)).toFixed(6)),
        price_per_share: new Prisma.Decimal(price),
        total_price: new Prisma.Decimal(total),
        down_payment: new Prisma.Decimal(
          Math.round((total * input.down_payment_pct) / 100),
        ),
        installment_count: input.installment_count,
        installment_frequency: offering.installment_frequency,
        reserved_on: toDate(reservedOn),
        hold_until: toDate(addDaysTo(reservedOn, offering.hold_days)),
        status: 'reserved',
        notes: input.notes?.trim() || null,
        sold_by_member_id: input.sold_by_member_id ?? null,
        created_by: currentActorId(),
      },
      select: SALE_SELECT,
    });
  });

  return dtoOf(prisma, row);
}

function addDaysTo(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Signing
 * ------------------------------------------------------------------ */

export interface SignInput {
  agreement_date: string;
  first_due_date?: string | null;
  /** the plan as agreed at the table, when it differs from the reservation */
  terms?: { shares: number; down_payment_pct: number; installment_count: number } | null;
  /** place, witnesses, stamp and notary — the agreement's own facts */
  signing?: Record<string, unknown> | null;
}

/**
 * Signs the agreement, which is the moment the purchase becomes real.
 *
 * Three things happen together, in one transaction: the plan is fixed, the
 * agreement gets its number, and the schedule is written from the plan. The
 * schedule is built by `lib/domain/share-sale.ts` — down payment on the
 * signing day, then equal installments by the round's frequency, the last one
 * taking the rounding.
 *
 * The customer must be named as the agreement names them (plan §4a): NID,
 * father's or spouse's name, present address. The paper checklist that also
 * gates this comes back when documents move to Postgres.
 */
export async function signAgreement(
  principal: StaffPrincipal,
  id: string,
  input: SignInput,
): Promise<ShareSaleDto> {
  const row = await withTx(async (tx: Tx) => {
    const sale = await loadSale(tx, id);
    assertWithinScope(principal, sale.project_id);
    if (sale.status !== 'reserved') throw conflict('Only a reservation can be signed.');

    if (input.agreement_date > today()) {
      throw invalid('The signing day cannot be in the future.', {
        agreement_date: 'Pick today or a day before it.',
      });
    }
    if (input.agreement_date < day(sale.reserved_on)) {
      throw invalid('The agreement cannot be signed before the shares were reserved.', {
        agreement_date: `The hold started ${day(sale.reserved_on)}.`,
      });
    }

    const customer = await tx.customer.findUnique({
      where: { id: sale.customer_id },
      select: { nid: true, father_or_spouse_name: true, address: true, name: true },
    });
    if (!customer) throw conflict('The customer on this reservation no longer exists.');
    const missing: string[] = [];
    if (!customer.nid?.trim()) missing.push('NID or passport number');
    if (!customer.father_or_spouse_name?.trim()) missing.push('father’s or spouse’s name');
    if (!customer.address?.trim()) missing.push('present address');
    if (missing.length > 0) {
      throw conflict(
        `The agreement names the customer by their ${missing.join(', ')}. Fill that in on ${customer.name}’s record first.`,
      );
    }

    /* the plan may be re-agreed at the table; it is checked again either way */
    const terms: OfferingTerms = {
      min_shares: sale.offering.min_shares,
      max_shares: sale.offering.max_shares,
      min_down_payment_pct: num(sale.offering.min_down_payment_pct),
      max_installments: sale.offering.max_installments,
    };
    const plan = input.terms ?? {
      shares: sale.shares,
      down_payment_pct: num(sale.total_price)
        ? Math.round((num(sale.down_payment) / num(sale.total_price)) * 100)
        : 0,
      installment_count: sale.installment_count,
    };
    checkPlan(terms, plan);

    if (input.terms) {
      const held = await heldInRound(tx, sale.offering_id, sale.id);
      const free = sale.offering.total_shares - held.total;
      if (plan.shares > free) {
        throw invalid(`Only ${free} share${free === 1 ? '' : 's'} can go to this purchase.`, {
          shares: `At most ${free}.`,
        });
      }
    }

    const price = num(sale.price_per_share);
    const total = plan.shares * price;
    const downPayment = Math.round((total * plan.down_payment_pct) / 100);

    const firstDue =
      plan.installment_count > 0
        ? (input.first_due_date ??
          addMonths(input.agreement_date, sale.offering.installment_frequency === 'monthly' ? 1 : 3))
        : input.agreement_date;
    if (plan.installment_count > 0 && firstDue <= input.agreement_date) {
      throw invalid('The first installment has to fall after the signing day.', {
        first_due_date: 'Pick a day after the signing.',
      });
    }

    const schedule = buildSchedule({
      total_price: total,
      down_payment: downPayment,
      installment_count: plan.installment_count,
      installment_frequency: sale.offering.installment_frequency,
      agreement_date: input.agreement_date,
      first_due_date: firstDue,
    });

    /*
     * A reservation has no schedule yet, but a re-signing would: the rows are
     * cleared and written again rather than patched, because the plan they
     * came from has changed. Nothing has been paid against them — payments
     * only happen after signing — so nothing is orphaned.
     */
    await tx.shareInstallment.deleteMany({ where: { sale_id: id } });
    await tx.shareInstallment.createMany({
      data: schedule.map((r) => ({
        sale_id: id,
        seq: r.seq,
        due_date: toDate(r.due_date),
        amount: new Prisma.Decimal(r.amount),
        created_by: currentActorId(),
      })),
    });

    return tx.shareSale.update({
      where: { id },
      data: {
        status: 'agreement_signed',
        agreement_no: await nextCode(tx, 'agreement'),
        agreement_date: toDate(input.agreement_date),
        first_due_date: toDate(firstDue),
        shares: plan.shares,
        share_pct: new Prisma.Decimal(
          (plan.shares * num(sale.offering.share_pct)).toFixed(6),
        ),
        total_price: new Prisma.Decimal(total),
        down_payment: new Prisma.Decimal(downPayment),
        installment_count: plan.installment_count,
        signing: (input.signing ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        sign_draft: Prisma.JsonNull,
      },
      select: SALE_SELECT,
    });
  });

  return dtoOf(prisma, row);
}

/* ------------------------------------------------------------------ *
 * Ending a purchase
 * ------------------------------------------------------------------ */

/** The hold lapsed or the customer walked away; the shares go back. */
export async function releaseSale(
  principal: StaffPrincipal,
  id: string,
  note: string,
): Promise<ShareSaleDto> {
  const row = await withTx(async (tx: Tx) => {
    const sale = await loadSale(tx, id);
    assertWithinScope(principal, sale.project_id);
    if (sale.status !== 'reserved') throw conflict('Only a reservation can be released.');
    return tx.shareSale.update({
      where: { id },
      data: { status: 'released', status_note: note.trim() || null },
      select: SALE_SELECT,
    });
  });
  return dtoOf(prisma, row);
}

/**
 * Ends a signed purchase, as the agreement allows.
 *
 * What was paid is not touched: the receipts stand, and what the customer gets
 * back is a decision somebody makes and records as money going out. Hiding the
 * payments would make the books disagree with the receipt book.
 */
export async function cancelSale(
  principal: StaffPrincipal,
  id: string,
  note: string,
): Promise<ShareSaleDto> {
  if (!note.trim()) {
    throw invalid('Say why the purchase is cancelled.', { status_note: 'A reason is required.' });
  }
  const row = await withTx(async (tx: Tx) => {
    const sale = await loadSale(tx, id);
    assertWithinScope(principal, sale.project_id);
    if (sale.status !== 'agreement_signed') {
      throw conflict('Only a signed purchase that is still being paid can be cancelled.');
    }
    return tx.shareSale.update({
      where: { id },
      data: { status: 'cancelled', status_note: note.trim() },
      select: SALE_SELECT,
    });
  });
  return dtoOf(prisma, row);
}

/* ------------------------------------------------------------------ *
 * Money in
 * ------------------------------------------------------------------ */

export interface PaymentInput {
  paid_on: string;
  amount: number;
  method: string;
  reference?: string | null;
  notes?: string | null;
  channel?: 'office' | 'online';
  method_detail?: string | null;
  account_id?: string | null;
}

/**
 * Records money received and applies it as the agreement says: late fees
 * first, then the oldest installment (plan §7).
 *
 * The fees are worked out as of the day the money was received, not today —
 * a receipt entered a week late must book what was owed then. The allocation
 * is written as rows, so "what is still owed on installment 4" is a SUM rather
 * than a re-reading of every receipt.
 */
export async function recordPayment(
  principal: StaffPrincipal,
  saleId: string,
  input: PaymentInput,
): Promise<ShareSaleDto> {
  return (await recordPaymentReturning(principal, saleId, input)).sale;
}

/**
 * The same, saying which receipt it wrote.
 *
 * A payment submission has to point at the receipt its confirmation created —
 * that link is what lets the customer see "confirmed, receipt SRC-2026-0004"
 * — and guessing it afterwards from the newest row on the purchase would be
 * wrong the moment two people confirm at once.
 */
export async function recordPaymentReturning(
  principal: StaffPrincipal,
  saleId: string,
  input: PaymentInput,
): Promise<{ sale: ShareSaleDto; payment_id: string }> {
  let paymentId = '';
  await withTx(async (tx: Tx) => {
    const sale = await loadSale(tx, saleId);
    assertWithinScope(principal, sale.project_id);
    if (sale.status !== 'agreement_signed' && sale.status !== 'fully_paid') {
      throw conflict('Money is recorded against a signed purchase.');
    }
    if (input.paid_on > today()) {
      throw invalid('The payment date cannot be in the future.', {
        paid_on: 'Pick today or a day before it.',
      });
    }
    const agreementDate = dayOrNull(sale.agreement_date);
    if (agreementDate && input.paid_on < agreementDate) {
      throw invalid('The payment date cannot be before the agreement was signed.', {
        paid_on: `The agreement was signed ${agreementDate}.`,
      });
    }

    const view = await viewOf(tx, sale, input.paid_on);
    const amount = Math.round(input.amount);
    if (!(amount > 0)) throw invalid('Enter an amount above 0.', { amount: 'More than ৳0.' });
    const max = maxSharePayable(view);
    if (amount > max) {
      throw invalid('That is more than is owed on this purchase.', {
        amount: `At most ৳${max.toLocaleString('en-IN')}.`,
      });
    }

    const allocations = allocateSharePayment(view, amount);
    const principalPaid = allocations.reduce((t, a) => t + a.principal, 0);
    const lateFee = allocations.reduce((t, a) => t + a.late_fee, 0);

    const created = await tx.sharePayment.create({
      select: { id: true },
      data: {
        code: await nextCode(tx, 'share_payment'),
        sale_id: saleId,
        paid_on: toDate(input.paid_on),
        amount: new Prisma.Decimal(principalPaid + lateFee),
        principal: new Prisma.Decimal(principalPaid),
        late_fee: new Prisma.Decimal(lateFee),
        method: input.method as Prisma.SharePaymentCreateInput['method'],
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        channel: (input.channel ?? 'office') as Prisma.SharePaymentCreateInput['channel'],
        method_detail: input.method_detail ?? null,
        account_id: input.account_id ?? null,
        created_by: currentActorId(),
        allocations: {
          create: allocations.map((a) => ({
            installment_id: a.installment_id,
            principal: new Prisma.Decimal(a.principal),
            late_fee: new Prisma.Decimal(a.late_fee),
          })),
        },
      },
    });
    paymentId = created.id;

    /* paid off? the purchase says so itself, rather than a job deciding later */
    const after = await viewOf(tx, sale);
    const done = after.schedule.length > 0 && after.schedule.every((r) => r.status === 'paid');
    if (done && sale.status !== 'fully_paid') {
      await tx.shareSale.update({ where: { id: saleId }, data: { status: 'fully_paid' } });
    } else if (!done && sale.status === 'fully_paid') {
      await tx.shareSale.update({ where: { id: saleId }, data: { status: 'agreement_signed' } });
    }
  });

  return { sale: await getSale(principal, saleId), payment_id: paymentId };
}

/* ------------------------------------------------------------------ *
 * Money that is not cash
 * ------------------------------------------------------------------ */

/** What this purchase owes as of a day — overdue principal plus late fees. */
export async function dueNowOn(client: Tx, saleId: string, asOf: string): Promise<number> {
  const sale = await client.shareSale.findUnique({ where: { id: saleId }, select: SALE_SELECT });
  if (!sale) return 0;
  if (sale.status !== 'agreement_signed' && sale.status !== 'fully_paid') return 0;
  const view = await viewOf(client, sale, asOf);
  return view.due_now;
}

/**
 * Pays part of a purchase out of the holder's own declared profit
 * (REVENUE-SHARE-PLAN.md §5.2).
 *
 * It is a real payment on the schedule — late fees first, oldest row first,
 * like any other — written with method `profit_adjustment` so the file shows
 * that no cash arrived. Called by the revenue service inside the declaring
 * transaction, which is why it takes the client rather than opening its own.
 */
export async function recordProfitAdjustment(
  client: Tx,
  saleId: string,
  amount: number,
  paidOn: string,
): Promise<void> {
  const sale = await loadSale(client, saleId);
  const view = await viewOf(client, sale, paidOn);
  const take = Math.min(Math.round(amount), Math.round(maxSharePayable(view)));
  if (take <= 0) return;

  const allocations = allocateSharePayment(view, take);
  const principalPaid = allocations.reduce((t, a) => t + a.principal, 0);
  const lateFee = allocations.reduce((t, a) => t + a.late_fee, 0);

  await client.sharePayment.create({
    data: {
      code: await nextCode(client, 'share_payment'),
      sale_id: saleId,
      paid_on: toDate(paidOn),
      amount: new Prisma.Decimal(principalPaid + lateFee),
      principal: new Prisma.Decimal(principalPaid),
      late_fee: new Prisma.Decimal(lateFee),
      method: 'profit_adjustment',
      notes: 'Paid from this holder’s declared profit',
      channel: 'office',
      created_by: currentActorId(),
      allocations: {
        create: allocations.map((a) => ({
          installment_id: a.installment_id,
          principal: new Prisma.Decimal(a.principal),
          late_fee: new Prisma.Decimal(a.late_fee),
        })),
      },
    },
  });

  const after = await viewOf(client, sale);
  if (after.schedule.length > 0 && after.schedule.every((r) => r.status === 'paid')) {
    await client.shareSale.update({ where: { id: saleId }, data: { status: 'fully_paid' } });
  }
}

/**
 * Corrects a receipt — by writing its opposite, never by changing it.
 *
 * `share_payments` refuses an UPDATE or a DELETE at the database level, which
 * is what makes the receipt book a receipt book. A reversal is a payment with
 * the amounts negated, pointing at the one it cancels, and the two net to
 * nothing wherever money is summed.
 */
export async function reversePayment(
  principal: StaffPrincipal,
  saleId: string,
  paymentId: string,
  reason: string,
): Promise<ShareSaleDto> {
  if (!reason.trim()) {
    throw invalid('Say why the receipt is being reversed.', { reason: 'A reason is required.' });
  }

  await withTx(async (tx: Tx) => {
    const sale = await loadSale(tx, saleId);
    assertWithinScope(principal, sale.project_id);
    if (sale.certificate_no) {
      throw conflict('This purchase has been certified; its receipts can no longer be reversed.');
    }

    const payment = (await tx.sharePayment.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    })) as PaymentRow | null;
    if (!payment || payment.sale_id !== saleId) throw notFound('That receipt');
    if (payment.reverses_payment_id) {
      throw conflict('That receipt is itself a reversal.');
    }
    const already = await tx.sharePayment.count({ where: { reverses_payment_id: paymentId } });
    if (already > 0) throw conflict('That receipt has already been reversed.');

    await tx.sharePayment.create({
      data: {
        code: await nextCode(tx, 'share_payment'),
        sale_id: saleId,
        paid_on: toDate(today()),
        amount: payment.amount.negated(),
        principal: payment.principal.negated(),
        late_fee: payment.late_fee.negated(),
        method: payment.method as Prisma.SharePaymentCreateInput['method'],
        reference: payment.code,
        notes: reason.trim(),
        channel: payment.channel as Prisma.SharePaymentCreateInput['channel'],
        account_id: payment.account_id,
        reverses_payment_id: payment.id,
        created_by: currentActorId(),
        allocations: {
          create: payment.allocations.map((a) => ({
            installment_id: a.installment_id,
            principal: a.principal.negated(),
            late_fee: a.late_fee.negated(),
          })),
        },
      },
    });

    if (sale.status === 'fully_paid') {
      await tx.shareSale.update({ where: { id: saleId }, data: { status: 'agreement_signed' } });
    }
  });

  return getSale(principal, saleId);
}
