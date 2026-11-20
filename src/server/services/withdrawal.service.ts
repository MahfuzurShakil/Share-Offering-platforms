import { Prisma } from '@prisma/client';
import { canWithdraw } from '@/lib/domain/revenue-share';
import { currentActorId } from '../audit/audit';
import { assertWithinScope, type StaffPrincipal } from '../auth/rbac';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';
import { today } from './share-offering.service';

/**
 * Profit balances, and asking for the money
 * (REVENUE-SHARE-PLAN.md §5.2–5.3).
 *
 * The balance is never stored. It is what has been credited to a holder, less
 * what has been paid out to them and what they have already asked for —
 * worked out from the rows every time. A stored balance would be a second
 * source of truth for the same money, and the two would disagree the first
 * time a declaration and a payout crossed.
 *
 * `requested` and `approved` both hold the money, which is what stops
 * somebody asking for the same taka twice while the first request is being
 * looked at.
 */

const num = (d: Prisma.Decimal) => d.toNumber();
const day = (d: Date) => d.toISOString().slice(0, 10);
const dayOrNull = (d: Date | null) => (d === null ? null : day(d));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export interface ProfitBalance {
  project_id: string;
  project_name: string;
  customer_id: string;
  /** everything credited to this holder on this project */
  credited: number;
  /** already paid out */
  paid_out: number;
  /** asked for and not yet paid or refused */
  pending: number;
  /** what they could ask for now */
  available: number;
}

/**
 * What a customer has, project by project.
 *
 * Per project because that is how the money was earned and how it is asked
 * for: a holder of shares in two projects has two balances, and one project's
 * profit never pays out of the other's.
 */
export async function balancesFor(customerId: string): Promise<ProfitBalance[]> {
  const [credited, withdrawn] = await Promise.all([
    prisma.profitAllocation.groupBy({
      by: ['project_id'],
      where: { customer_id: customerId },
      _sum: { net_credited: true },
    }),
    prisma.profitWithdrawal.groupBy({
      by: ['project_id', 'status'],
      where: { customer_id: customerId, deleted_at: null },
      _sum: { amount: true },
    }),
  ]);

  const projectIds = [
    ...new Set([
      ...(credited as { project_id: string }[]).map((r) => r.project_id),
      ...(withdrawn as { project_id: string }[]).map((r) => r.project_id),
    ]),
  ];
  if (projectIds.length === 0) return [];

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(
    (projects as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  const out = new Map<string, ProfitBalance>(
    projectIds.map((id) => [
      id,
      {
        project_id: id,
        project_name: nameOf.get(id) ?? '—',
        customer_id: customerId,
        credited: 0,
        paid_out: 0,
        pending: 0,
        available: 0,
      },
    ]),
  );

  for (const row of credited as { project_id: string; _sum: { net_credited: Prisma.Decimal | null } }[]) {
    out.get(row.project_id)!.credited = row._sum.net_credited?.toNumber() ?? 0;
  }
  for (const row of withdrawn as {
    project_id: string;
    status: string;
    _sum: { amount: Prisma.Decimal | null };
  }[]) {
    const amount = row._sum.amount?.toNumber() ?? 0;
    const balance = out.get(row.project_id)!;
    if (row.status === 'paid') balance.paid_out += amount;
    else if (row.status === 'requested' || row.status === 'approved') balance.pending += amount;
  }
  for (const balance of out.values()) {
    balance.available = Math.max(0, balance.credited - balance.paid_out - balance.pending);
  }

  return [...out.values()].sort((a, b) => b.available - a.available);
}

/* ------------------------------------------------------------------ *
 * The requests
 * ------------------------------------------------------------------ */

const WITHDRAWAL_SELECT = {
  id: true,
  code: true,
  project_id: true,
  holder_type: true,
  customer_id: true,
  partner_id: true,
  amount: true,
  method: true,
  pay_to: true,
  status: true,
  requested_on: true,
  channel: true,
  decided_on: true,
  reject_reason: true,
  paid_on: true,
  account_id: true,
  reference_no: true,
  notes: true,
  created_at: true,
  updated_at: true,
  project: { select: { name: true } },
  customer: { select: { code: true, name: true, phone: true } },
} satisfies Prisma.ProfitWithdrawalSelect;

type WithdrawalRow = Prisma.ProfitWithdrawalGetPayload<{ select: typeof WITHDRAWAL_SELECT }>;

export interface WithdrawalDto {
  id: string;
  code: string;
  project_id: string;
  project_name: string;
  holder_type: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number;
  method: string;
  pay_to: string;
  status: string;
  requested_on: string;
  channel: string;
  decided_on: string | null;
  reject_reason: string | null;
  paid_on: string | null;
  account_id: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const toDto = (row: WithdrawalRow): WithdrawalDto => ({
  id: row.id,
  code: row.code,
  project_id: row.project_id,
  project_name: row.project.name,
  holder_type: row.holder_type,
  customer_id: row.customer_id,
  customer_code: row.customer?.code ?? null,
  customer_name: row.customer?.name ?? null,
  customer_phone: row.customer?.phone ?? null,
  amount: num(row.amount),
  method: row.method,
  pay_to: row.pay_to,
  status: row.status,
  requested_on: day(row.requested_on),
  channel: row.channel,
  decided_on: dayOrNull(row.decided_on),
  reject_reason: row.reject_reason,
  paid_on: dayOrNull(row.paid_on),
  account_id: row.account_id,
  reference_no: row.reference_no,
  notes: row.notes,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

export interface WithdrawalFilters {
  project_id?: string;
  customer_id?: string;
  status?: string;
}

export async function listWithdrawals(
  principal: StaffPrincipal,
  filters: WithdrawalFilters = {},
  paging: { page?: number; page_size?: number } = {},
) {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 100));

  const where: Prisma.ProfitWithdrawalWhereInput = {};
  if (principal.project_ids.length > 0) where.project_id = { in: principal.project_ids };
  if (filters.project_id) {
    assertWithinScope(principal, filters.project_id);
    where.project_id = filters.project_id;
  }
  if (filters.customer_id) where.customer_id = filters.customer_id;
  if (filters.status) {
    where.status = filters.status as Prisma.ProfitWithdrawalWhereInput['status'];
  }

  const [rows, total] = await Promise.all([
    prisma.profitWithdrawal.findMany({
      where,
      select: WITHDRAWAL_SELECT,
      orderBy: [{ requested_on: 'desc' }, { code: 'desc' }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.profitWithdrawal.count({ where }),
  ]);

  return { rows: rows.map(toDto), total, page, page_size };
}

export interface RequestInput {
  project_id: string;
  customer_id: string;
  amount: number;
  method: string;
  pay_to: string;
  channel?: 'portal' | 'office';
}

/**
 * Asks for part of a balance.
 *
 * Two rules the policy sets and the domain checks: at least the minimum, and
 * inside the window — some projects pay out only in the days after a
 * declaration, or on one day a month. Everything else is arithmetic: nobody
 * may ask for more than is actually theirs right now.
 */
export async function requestWithdrawal(
  principal: StaffPrincipal,
  input: RequestInput,
): Promise<WithdrawalDto> {
  assertWithinScope(principal, input.project_id);

  const row = await withTx(async (tx: Tx) => {
    const policy = await tx.revenuePolicy.findUnique({
      where: { project_id: input.project_id },
      select: {
        min_withdrawal: true,
        withdrawal_window: true,
        withdrawal_window_days: true,
      },
    });
    if (!policy) throw conflict('This project does not share its profit.');

    const customer = await tx.customer.findUnique({
      where: { id: input.customer_id },
      select: { id: true },
    });
    if (!customer) throw invalid('That customer no longer exists.', { customer_id: 'Pick one.' });

    const balance = (await balancesFor(input.customer_id)).find(
      (b) => b.project_id === input.project_id,
    );
    const available = balance?.available ?? 0;
    const amount = Math.round(input.amount);

    if (!(amount > 0)) throw invalid('Enter an amount above 0.', { amount: 'More than ৳0.' });
    if (amount > available) {
      throw invalid('That is more than this balance holds.', {
        amount: `At most ৳${available.toLocaleString('en-IN')}.`,
      });
    }

    /* the last declaration on this project decides an `after_declare` window */
    const lastDeclared = await tx.revenuePeriod.findFirst({
      where: { project_id: input.project_id, status: 'declared', deleted_at: null },
      orderBy: { declared_on: 'desc' },
      select: { declared_on: true },
    });

    const check = canWithdraw(
      {
        min_withdrawal: num(policy.min_withdrawal),
        withdrawal_window: policy.withdrawal_window,
        withdrawal_window_days: policy.withdrawal_window_days,
      } as never,
      amount,
      dayOrNull(lastDeclared?.declared_on ?? null),
      today(),
    );
    if (!check.ok) throw conflict(check.reason ?? 'This cannot be withdrawn yet.');

    if (!input.pay_to.trim()) {
      throw invalid('Say where the money should go.', {
        pay_to: 'An account or wallet number.',
      });
    }

    return tx.profitWithdrawal.create({
      data: {
        code: await nextCode(tx, 'profit_withdrawal'),
        project_id: input.project_id,
        holder_type: 'customer',
        customer_id: input.customer_id,
        amount: new Prisma.Decimal(amount),
        method: input.method as Prisma.ProfitWithdrawalUncheckedCreateInput['method'],
        pay_to: input.pay_to.trim(),
        status: 'requested',
        requested_on: toDate(today()),
        channel: input.channel ?? 'office',
        created_by: currentActorId(),
      },
      select: WITHDRAWAL_SELECT,
    });
  });

  return toDto(row);
}

async function loadRequest(client: Tx, id: string): Promise<WithdrawalRow> {
  const row = await client.profitWithdrawal.findUnique({
    where: { id },
    select: WITHDRAWAL_SELECT,
  });
  if (!row) throw notFound('That request');
  return row;
}

/** Accepts a request. The money stays held until it is actually paid. */
export async function approveWithdrawal(
  principal: StaffPrincipal,
  id: string,
): Promise<WithdrawalDto> {
  const row = await withTx(async (tx: Tx) => {
    const request = await loadRequest(tx, id);
    assertWithinScope(principal, request.project_id);
    if (request.status !== 'requested') {
      throw conflict('Only a request that is still waiting can be approved.');
    }
    return tx.profitWithdrawal.update({
      where: { id },
      data: { status: 'approved', decided_by: currentActorId(), decided_on: toDate(today()) },
      select: WITHDRAWAL_SELECT,
    });
  });
  return toDto(row);
}

/** Turns a request down, with the reason the holder will be told. */
export async function rejectWithdrawal(
  principal: StaffPrincipal,
  id: string,
  reason: string,
): Promise<WithdrawalDto> {
  if (!reason.trim()) {
    throw invalid('Say why it is being refused.', { reason: 'A reason is required.' });
  }
  const row = await withTx(async (tx: Tx) => {
    const request = await loadRequest(tx, id);
    assertWithinScope(principal, request.project_id);
    if (request.status === 'paid') throw conflict('That one has already been paid.');
    if (request.status === 'rejected') throw conflict('That one was already refused.');
    return tx.profitWithdrawal.update({
      where: { id },
      data: {
        status: 'rejected',
        reject_reason: reason.trim(),
        decided_by: currentActorId(),
        decided_on: toDate(today()),
      },
      select: WITHDRAWAL_SELECT,
    });
  });
  return toDto(row);
}

export interface PayInput {
  paid_on: string;
  account_id?: string | null;
  reference_no?: string | null;
  notes?: string | null;
}

/** Records the payout: the money leaves the balance for good. */
export async function payWithdrawal(
  principal: StaffPrincipal,
  id: string,
  input: PayInput,
): Promise<WithdrawalDto> {
  const row = await withTx(async (tx: Tx) => {
    const request = await loadRequest(tx, id);
    assertWithinScope(principal, request.project_id);
    if (request.status !== 'approved') {
      throw conflict('A payout is recorded against an approved request.');
    }
    if (input.paid_on > today()) {
      throw invalid('The payment date cannot be in the future.', {
        paid_on: 'Today or earlier.',
      });
    }
    if (input.paid_on < day(request.requested_on)) {
      throw invalid('It cannot be paid before it was asked for.', {
        paid_on: `On or after ${day(request.requested_on)}.`,
      });
    }

    return tx.profitWithdrawal.update({
      where: { id },
      data: {
        status: 'paid',
        paid_on: toDate(input.paid_on),
        account_id: input.account_id ?? null,
        reference_no: input.reference_no?.trim() || null,
        notes: input.notes?.trim() || null,
      },
      select: WITHDRAWAL_SELECT,
    });
  });
  return toDto(row);
}
