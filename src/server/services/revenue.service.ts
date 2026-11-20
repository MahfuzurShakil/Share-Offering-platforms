import { Prisma } from '@prisma/client';
import {
  eligibilityFactor,
  periodLabel,
  periodsThrough,
  splitDeclared,
  workOutStatement,
  type CustomerHolding,
  type OwnerSlice,
} from '@/lib/domain/revenue-share';
import { currentActorId } from '../audit/audit';
import { assertWithinScope, type StaffPrincipal } from '../auth/rbac';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';
import { today } from './share-offering.service';

/**
 * What a project earns, and how the profit is divided
 * (REVENUE-SHARE-PLAN.md).
 *
 * The business this product is for does not only sell shares: it runs the
 * thing the shares are in — a hotel, a market — and hands the profit back to
 * the people who bought into it. That is this file.
 *
 * None of the arithmetic is here. `lib/domain/revenue-share.ts` works out the
 * statement (past loss, reserve, management fee, loans — in that order), who
 * is eligible and for how much of a full share, and how a declared amount
 * splits so that the lines always add back up to it. It is pure and unit
 * tested, and the browser runs the same code to show a period before anybody
 * closes it. What is here is *when* those sums are allowed and what they are
 * frozen into.
 *
 * The one thing deliberately left out: the owners' side is a single line for
 * now, because who the owners are — company partners, project investors and
 * their percentages — lives in the Money module, which is still on the interim
 * layer. The split already works out what the owners get; when partners move,
 * that one line becomes several and nothing else changes.
 */

/* ------------------------------------------------------------------ *
 * The policy
 * ------------------------------------------------------------------ */

const POLICY_SELECT = {
  id: true,
  project_id: true,
  entry_frequency: true,
  distribution_frequency: true,
  first_period_start: true,
  reserve_pct: true,
  mgmt_fee_type: true,
  mgmt_fee_value: true,
  tax_withholding_pct: true,
  loss_rule: true,
  eligibility_rule: true,
  prorate_days: true,
  repay_loans_first: true,
  min_withdrawal: true,
  withdrawal_window: true,
  withdrawal_window_days: true,
  adjust_overdue_first: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.RevenuePolicySelect;

type PolicyRow = Prisma.RevenuePolicyGetPayload<{ select: typeof POLICY_SELECT }>;

const num = (d: Prisma.Decimal) => d.toNumber();
const day = (d: Date) => d.toISOString().slice(0, 10);
const dayOrNull = (d: Date | null) => (d === null ? null : day(d));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export interface RevenuePolicyDto {
  id: string;
  project_id: string;
  entry_frequency: string;
  distribution_frequency: string;
  first_period_start: string;
  reserve_pct: number;
  mgmt_fee_type: string;
  mgmt_fee_value: number;
  tax_withholding_pct: number;
  loss_rule: string;
  eligibility_rule: string;
  prorate_days: boolean;
  repay_loans_first: boolean;
  min_withdrawal: number;
  withdrawal_window: string;
  withdrawal_window_days: number;
  adjust_overdue_first: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toPolicyDto(row: PolicyRow): RevenuePolicyDto {
  return {
    id: row.id,
    project_id: row.project_id,
    entry_frequency: row.entry_frequency,
    distribution_frequency: row.distribution_frequency,
    first_period_start: day(row.first_period_start),
    reserve_pct: num(row.reserve_pct),
    mgmt_fee_type: row.mgmt_fee_type,
    mgmt_fee_value: num(row.mgmt_fee_value),
    tax_withholding_pct: num(row.tax_withholding_pct),
    loss_rule: row.loss_rule,
    eligibility_rule: row.eligibility_rule,
    prorate_days: row.prorate_days,
    repay_loans_first: row.repay_loans_first,
    min_withdrawal: num(row.min_withdrawal),
    withdrawal_window: row.withdrawal_window,
    withdrawal_window_days: row.withdrawal_window_days,
    adjust_overdue_first: row.adjust_overdue_first,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export interface PolicyInput {
  entry_frequency?: string;
  distribution_frequency?: string;
  first_period_start?: string;
  reserve_pct?: number;
  mgmt_fee_type?: string;
  mgmt_fee_value?: number;
  tax_withholding_pct?: number;
  loss_rule?: string;
  eligibility_rule?: string;
  prorate_days?: boolean;
  repay_loans_first?: boolean;
  min_withdrawal?: number;
  withdrawal_window?: string;
  withdrawal_window_days?: number;
  adjust_overdue_first?: boolean;
  notes?: string | null;
}

export async function getPolicy(
  principal: StaffPrincipal,
  projectId: string,
): Promise<RevenuePolicyDto | null> {
  assertWithinScope(principal, projectId);
  const row = await prisma.revenuePolicy.findUnique({
    where: { project_id: projectId },
    select: POLICY_SELECT,
  });
  return row ? toPolicyDto(row) : null;
}

/** Columns from input, with `undefined` meaning "leave it alone". */
function policyColumns(input: PolicyInput) {
  return {
    entry_frequency: input.entry_frequency as Prisma.RevenuePolicyUncheckedUpdateInput['entry_frequency'],
    distribution_frequency:
      input.distribution_frequency as Prisma.RevenuePolicyUncheckedUpdateInput['distribution_frequency'],
    first_period_start: input.first_period_start ? toDate(input.first_period_start) : undefined,
    reserve_pct: input.reserve_pct,
    mgmt_fee_type: input.mgmt_fee_type as Prisma.RevenuePolicyUncheckedUpdateInput['mgmt_fee_type'],
    mgmt_fee_value: input.mgmt_fee_value,
    tax_withholding_pct: input.tax_withholding_pct,
    loss_rule: input.loss_rule as Prisma.RevenuePolicyUncheckedUpdateInput['loss_rule'],
    eligibility_rule:
      input.eligibility_rule as Prisma.RevenuePolicyUncheckedUpdateInput['eligibility_rule'],
    prorate_days: input.prorate_days,
    repay_loans_first: input.repay_loans_first,
    min_withdrawal: input.min_withdrawal,
    withdrawal_window:
      input.withdrawal_window as Prisma.RevenuePolicyUncheckedUpdateInput['withdrawal_window'],
    withdrawal_window_days: input.withdrawal_window_days,
    adjust_overdue_first: input.adjust_overdue_first,
    notes: input.notes,
  };
}

/**
 * Turns profit sharing on for a project, or changes how it works.
 *
 * Changing the settings never re-reads a period that has been closed: the
 * statement was frozen with the rules that applied to it, which is what makes
 * last quarter's figures still true next quarter.
 */
export async function savePolicy(
  principal: StaffPrincipal,
  projectId: string,
  input: PolicyInput,
): Promise<RevenuePolicyDto> {
  assertWithinScope(principal, projectId);

  const row = await withTx(async (tx: Tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw notFound('That project');

    const current = await tx.revenuePolicy.findUnique({
      where: { project_id: projectId },
      select: { id: true, first_period_start: true },
    });

    if (!current && !input.first_period_start) {
      throw invalid('Say when the first profit period starts.', {
        first_period_start: 'The day the project started earning.',
      });
    }

    /*
     * Moving the first period after periods exist would renumber and re-date
     * them, and a declared period cannot move at all.
     */
    if (current && input.first_period_start && day(current.first_period_start) !== input.first_period_start) {
      const periods = await tx.revenuePeriod.count({
        where: { project_id: projectId, deleted_at: null },
      });
      if (periods > 0) {
        throw conflict(
          'Periods have already been closed on this project, so the first period cannot be moved.',
        );
      }
    }

    if (current) {
      return tx.revenuePolicy.update({
        where: { project_id: projectId },
        data: policyColumns(input),
        select: POLICY_SELECT,
      });
    }
    return tx.revenuePolicy.create({
      data: {
        ...(policyColumns(input) as Prisma.RevenuePolicyUncheckedCreateInput),
        project_id: projectId,
        first_period_start: toDate(input.first_period_start!),
        created_by: currentActorId(),
      },
      select: POLICY_SELECT,
    });
  });

  return toPolicyDto(row);
}

async function policyOf(client: Tx, projectId: string): Promise<PolicyRow> {
  const row = await client.revenuePolicy.findUnique({
    where: { project_id: projectId },
    select: POLICY_SELECT,
  });
  if (!row) {
    throw conflict(
      'This project does not share its profit yet. Set it up on the project’s Income & Profit tab first.',
    );
  }
  return row;
}

/* ------------------------------------------------------------------ *
 * Income and cost
 * ------------------------------------------------------------------ */

const ENTRY_SELECT = {
  id: true,
  code: true,
  project_id: true,
  entry_date: true,
  direction: true,
  head: true,
  amount: true,
  account_id: true,
  reference_no: true,
  notes: true,
  period_id: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.RevenueEntrySelect;

type EntryRow = Prisma.RevenueEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

export interface RevenueEntryDto {
  id: string;
  code: string;
  project_id: string;
  entry_date: string;
  direction: string;
  head: string;
  amount: number;
  account_id: string | null;
  reference_no: string | null;
  notes: string | null;
  /** set once the period it falls in has been closed; it is locked then */
  period_id: string | null;
  locked: boolean;
  created_at: string;
  updated_at: string;
}

const toEntryDto = (row: EntryRow): RevenueEntryDto => ({
  id: row.id,
  code: row.code,
  project_id: row.project_id,
  entry_date: day(row.entry_date),
  direction: row.direction,
  head: row.head,
  amount: num(row.amount),
  account_id: row.account_id,
  reference_no: row.reference_no,
  notes: row.notes,
  period_id: row.period_id,
  locked: row.period_id !== null,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

export interface EntryInput {
  entry_date: string;
  direction: 'income' | 'cost';
  head: string;
  amount: number;
  account_id?: string | null;
  reference_no?: string | null;
  notes?: string | null;
}

export interface EntryFilters {
  from?: string;
  to?: string;
  direction?: string;
  head?: string;
}

export async function listEntries(
  principal: StaffPrincipal,
  projectId: string,
  filters: EntryFilters = {},
  paging: { page?: number; page_size?: number } = {},
) {
  assertWithinScope(principal, projectId);
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(500, Math.max(1, paging.page_size ?? 100));

  const where: Prisma.RevenueEntryWhereInput = { project_id: projectId };
  if (filters.from || filters.to) {
    where.entry_date = {
      ...(filters.from ? { gte: toDate(filters.from) } : {}),
      ...(filters.to ? { lte: toDate(filters.to) } : {}),
    };
  }
  if (filters.direction) {
    where.direction = filters.direction as Prisma.RevenueEntryWhereInput['direction'];
  }
  if (filters.head) where.head = filters.head;

  const [rows, total] = await Promise.all([
    prisma.revenueEntry.findMany({
      where,
      select: ENTRY_SELECT,
      orderBy: [{ entry_date: 'desc' }, { code: 'desc' }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.revenueEntry.count({ where }),
  ]);
  return { rows: rows.map(toEntryDto), total, page, page_size };
}

/** An entry is refused inside a period that has been closed. */
async function assertPeriodOpen(client: Tx, projectId: string, date: string): Promise<void> {
  const closed = await client.revenuePeriod.findFirst({
    where: {
      project_id: projectId,
      deleted_at: null,
      status: { not: 'cancelled' },
      period_start: { lte: toDate(date) },
      period_end: { gte: toDate(date) },
    },
    select: { label: true },
  });
  if (closed) {
    throw conflict(
      `${closed.label} has been closed. Record the correction in the period that is still open.`,
    );
  }
}

export async function createEntry(
  principal: StaffPrincipal,
  projectId: string,
  input: EntryInput,
): Promise<RevenueEntryDto> {
  assertWithinScope(principal, projectId);
  if (!(input.amount > 0)) throw invalid('Enter an amount above 0.', { amount: 'More than ৳0.' });
  if (input.entry_date > today()) {
    throw invalid('An entry cannot be dated in the future.', { entry_date: 'Today or earlier.' });
  }

  const row = await withTx(async (tx: Tx) => {
    const policy = await policyOf(tx, projectId);
    if (input.entry_date < day(policy.first_period_start)) {
      throw invalid('That is before this project started earning.', {
        entry_date: `On or after ${day(policy.first_period_start)}.`,
      });
    }
    await assertPeriodOpen(tx, projectId, input.entry_date);

    return tx.revenueEntry.create({
      data: {
        code: await nextCode(tx, 'revenue_entry'),
        project_id: projectId,
        entry_date: toDate(input.entry_date),
        direction: input.direction,
        head: input.head.trim(),
        amount: new Prisma.Decimal(input.amount),
        account_id: input.account_id ?? null,
        reference_no: input.reference_no?.trim() || null,
        notes: input.notes?.trim() || null,
        created_by: currentActorId(),
      },
      select: ENTRY_SELECT,
    });
  });
  return toEntryDto(row);
}

export async function deleteEntry(principal: StaffPrincipal, id: string): Promise<void> {
  const row = await prisma.revenueEntry.findUnique({
    where: { id },
    select: { id: true, project_id: true, period_id: true },
  });
  if (!row) throw notFound('That entry');
  assertWithinScope(principal, row.project_id);
  if (row.period_id) {
    throw conflict(
      'This entry is in a closed period. Correct it with an entry in the period that is open.',
    );
  }
  await prisma.revenueEntry.delete({ where: { id } });
}

/* ------------------------------------------------------------------ *
 * Periods
 * ------------------------------------------------------------------ */

const PERIOD_SELECT = {
  id: true,
  code: true,
  project_id: true,
  period_start: true,
  period_end: true,
  label: true,
  status: true,
  income: true,
  cost: true,
  operating_profit: true,
  loss_brought_in: true,
  reserve: true,
  mgmt_fee: true,
  loan_principal_due: true,
  available: true,
  loss_carried_out: true,
  declared: true,
  record_date: true,
  approved_on: true,
  declared_on: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.RevenuePeriodSelect;

type PeriodRow = Prisma.RevenuePeriodGetPayload<{ select: typeof PERIOD_SELECT }>;

export interface RevenuePeriodDto {
  id: string;
  code: string;
  project_id: string;
  period_start: string;
  period_end: string;
  label: string;
  status: string;
  income: number;
  cost: number;
  operating_profit: number;
  loss_brought_in: number;
  reserve: number;
  mgmt_fee: number;
  loan_principal_due: number;
  available: number;
  loss_carried_out: number;
  declared: number;
  record_date: string | null;
  approved_on: string | null;
  declared_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const toPeriodDto = (row: PeriodRow): RevenuePeriodDto => ({
  id: row.id,
  code: row.code,
  project_id: row.project_id,
  period_start: day(row.period_start),
  period_end: day(row.period_end),
  label: row.label,
  status: row.status,
  income: num(row.income),
  cost: num(row.cost),
  operating_profit: num(row.operating_profit),
  loss_brought_in: num(row.loss_brought_in),
  reserve: num(row.reserve),
  mgmt_fee: num(row.mgmt_fee),
  loan_principal_due: num(row.loan_principal_due),
  available: num(row.available),
  loss_carried_out: num(row.loss_carried_out),
  declared: num(row.declared),
  record_date: dayOrNull(row.record_date),
  approved_on: dayOrNull(row.approved_on),
  declared_on: dayOrNull(row.declared_on),
  notes: row.notes,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

/** A period that has not been closed yet: dates, and what the entries say. */
export interface OpenPeriodDto {
  period_start: string;
  period_end: string;
  label: string;
  income: number;
  cost: number;
  operating_profit: number;
  loss_brought_in: number;
  reserve: number;
  mgmt_fee: number;
  loan_principal_due: number;
  available: number;
  loss_carried_out: number;
  /** true once the period's last day has passed, so it can be closed */
  closable: boolean;
}

/** What one period's entries add up to, by direction. */
async function totalsFor(client: Tx, projectId: string, start: string, end: string) {
  const rows = await client.revenueEntry.groupBy({
    by: ['direction'],
    where: {
      project_id: projectId,
      deleted_at: null,
      entry_date: { gte: toDate(start), lte: toDate(end) },
    },
    _sum: { amount: true },
  });
  let income = 0;
  let cost = 0;
  for (const row of rows as { direction: string; _sum: { amount: Prisma.Decimal | null } }[]) {
    const value = row._sum.amount?.toNumber() ?? 0;
    if (row.direction === 'income') income += value;
    else cost += value;
  }
  return { income, cost };
}

/** The loss carried out of the latest closed period, which the next one eats. */
async function lossBroughtIn(client: Tx, projectId: string, before: string): Promise<number> {
  const last = await client.revenuePeriod.findFirst({
    where: {
      project_id: projectId,
      deleted_at: null,
      status: { not: 'cancelled' },
      period_end: { lt: toDate(before) },
    },
    orderBy: { period_end: 'desc' },
    select: { loss_carried_out: true },
  });
  return last ? num(last.loss_carried_out) : 0;
}

export interface PeriodsView {
  policy: RevenuePolicyDto | null;
  closed: RevenuePeriodDto[];
  /** the periods the policy says exist but nobody has closed yet */
  open: OpenPeriodDto[];
}

/**
 * Every period of a project: the ones that are closed, with their frozen
 * statements, and the ones still open, worked out live from the entries.
 *
 * The open ones are not rows in the database — a period becomes a row when
 * somebody closes it. Until then it is a date range and a sum, which is
 * exactly what the plan means by "periods are generated from the settings".
 */
export async function listPeriods(
  principal: StaffPrincipal,
  projectId: string,
): Promise<PeriodsView> {
  assertWithinScope(principal, projectId);
  const policyRow = await prisma.revenuePolicy.findUnique({
    where: { project_id: projectId },
    select: POLICY_SELECT,
  });
  if (!policyRow) return { policy: null, closed: [], open: [] };

  const closedRows = await prisma.revenuePeriod.findMany({
    where: { project_id: projectId, deleted_at: null },
    select: PERIOD_SELECT,
    orderBy: { period_start: 'asc' },
  });
  const closed: RevenuePeriodDto[] = closedRows.map(toPeriodDto);
  const taken = new Set(closed.map((p) => p.period_start));

  const policy = toPolicyDto(policyRow);
  const spans = periodsThrough(
    {
      distribution_frequency: policyRow.distribution_frequency,
      first_period_start: day(policyRow.first_period_start),
    } as never,
    today(),
  );

  const open: OpenPeriodDto[] = [];
  for (const span of spans) {
    if (taken.has(span.start)) continue;
    const totals = await totalsFor(prisma, projectId, span.start, span.end);
    const statement = workOutStatement({
      income: totals.income,
      cost: totals.cost,
      loss_brought_in: await lossBroughtIn(prisma, projectId, span.start),
      loss_rule: policyRow.loss_rule,
      reserve_pct: num(policyRow.reserve_pct),
      mgmt_fee_type: policyRow.mgmt_fee_type,
      mgmt_fee_value: num(policyRow.mgmt_fee_value),
      loan_principal_due: 0,
      repay_loans_first: policyRow.repay_loans_first,
    });
    open.push({
      period_start: span.start,
      period_end: span.end,
      label: periodLabel(policyRow.distribution_frequency, span.start, span.end),
      ...statement,
      closable: span.end < today(),
    });
  }

  return { policy, closed, open };
}

export interface PeriodRowDto extends RevenuePeriodDto {
  project_name: string;
  /** how many holders were credited, once it is declared */
  holders: number;
}

/**
 * Every closed period across every project, for the Profit Distributions
 * screen — which is the one place somebody looks to answer "what have we
 * declared, and on which projects".
 */
export async function listAllPeriods(
  principal: StaffPrincipal,
  filters: { project_id?: string; status?: string } = {},
): Promise<PeriodRowDto[]> {
  const where: Prisma.RevenuePeriodWhereInput = { deleted_at: null };
  if (principal.project_ids.length > 0) where.project_id = { in: principal.project_ids };
  if (filters.project_id) {
    assertWithinScope(principal, filters.project_id);
    where.project_id = filters.project_id;
  }
  if (filters.status) {
    where.status = filters.status as Prisma.RevenuePeriodWhereInput['status'];
  }

  const rows = await prisma.revenuePeriod.findMany({
    where,
    orderBy: [{ period_start: 'desc' }],
    include: {
      project: { select: { name: true } },
      _count: { select: { allocations: true } },
    },
  });

  type Row = Prisma.RevenuePeriodGetPayload<{
    include: { project: { select: { name: true } }; _count: { select: { allocations: true } } };
  }>;

  return (rows as Row[]).map((row) => ({
    ...toPeriodDto(row as unknown as PeriodRow),
    project_name: row.project.name,
    holders: row._count.allocations,
  }));
}

/**
 * Closes a period: no more entries in it, and the statement is frozen.
 *
 * Every entry that falls inside it is stamped with the period, which is what
 * locks it — the rule "corrections go in the next period" is enforced by that
 * stamp rather than by asking people to remember it.
 */
export async function closePeriod(
  principal: StaffPrincipal,
  projectId: string,
  periodStart: string,
): Promise<RevenuePeriodDto> {
  assertWithinScope(principal, projectId);

  const row = await withTx(async (tx: Tx) => {
    const policy = await policyOf(tx, projectId);
    const spans = periodsThrough(
      {
        distribution_frequency: policy.distribution_frequency,
        first_period_start: day(policy.first_period_start),
      } as never,
      today(),
    );
    const span = spans.find((s) => s.start === periodStart);
    if (!span) {
      throw invalid('That is not one of this project’s periods.', {
        period_start: 'Pick a period from the list.',
      });
    }
    if (span.end >= today()) {
      throw conflict(`${periodLabel(policy.distribution_frequency, span.start, span.end)} has not ended yet.`);
    }

    const already = await tx.revenuePeriod.findFirst({
      where: { project_id: projectId, period_start: toDate(span.start) },
      select: { id: true },
    });
    if (already) throw conflict('That period has already been closed.');

    const totals = await totalsFor(tx, projectId, span.start, span.end);
    const statement = workOutStatement({
      income: totals.income,
      cost: totals.cost,
      loss_brought_in: await lossBroughtIn(tx, projectId, span.start),
      loss_rule: policy.loss_rule,
      reserve_pct: num(policy.reserve_pct),
      mgmt_fee_type: policy.mgmt_fee_type,
      mgmt_fee_value: num(policy.mgmt_fee_value),
      loan_principal_due: 0,
      repay_loans_first: policy.repay_loans_first,
    });

    const period = await tx.revenuePeriod.create({
      data: {
        code: await nextCode(tx, 'revenue_period'),
        project_id: projectId,
        period_start: toDate(span.start),
        period_end: toDate(span.end),
        label: periodLabel(policy.distribution_frequency, span.start, span.end),
        status: 'closed',
        income: new Prisma.Decimal(statement.income),
        cost: new Prisma.Decimal(statement.cost),
        operating_profit: new Prisma.Decimal(statement.operating_profit),
        loss_brought_in: new Prisma.Decimal(statement.loss_brought_in),
        reserve: new Prisma.Decimal(statement.reserve),
        mgmt_fee: new Prisma.Decimal(statement.mgmt_fee),
        loan_principal_due: new Prisma.Decimal(statement.loan_principal_due),
        available: new Prisma.Decimal(statement.available),
        loss_carried_out: new Prisma.Decimal(statement.loss_carried_out),
        closed_by: currentActorId(),
        created_by: currentActorId(),
      },
      select: PERIOD_SELECT,
    });

    await tx.revenueEntry.updateMany({
      where: {
        project_id: projectId,
        deleted_at: null,
        entry_date: { gte: toDate(span.start), lte: toDate(span.end) },
      },
      data: { period_id: period.id },
    });

    return period;
  });

  return toPeriodDto(row);
}

/** Lets a closed period be opened again, while nobody has approved it. */
export async function reopenPeriod(
  principal: StaffPrincipal,
  periodId: string,
): Promise<void> {
  await withTx(async (tx: Tx) => {
    const period = await tx.revenuePeriod.findUnique({
      where: { id: periodId },
      select: { id: true, project_id: true, status: true, label: true },
    });
    if (!period) throw notFound('That period');
    assertWithinScope(principal, period.project_id);
    if (period.status !== 'closed') {
      throw conflict(`${period.label} has been approved. It cannot be opened again.`);
    }
    await tx.revenueEntry.updateMany({ where: { period_id: periodId }, data: { period_id: null } });
    await tx.revenuePeriod.delete({ where: { id: periodId } });
  });
}

/**
 * Approves the statement and sets what will be shared.
 *
 * Management may keep some of what is available back — a hotel going into its
 * low season — so the declared amount is a decision, not a sum. It can never
 * be more than the statement allows.
 */
export async function approvePeriod(
  principal: StaffPrincipal,
  periodId: string,
  declared: number,
): Promise<RevenuePeriodDto> {
  const row = await withTx(async (tx: Tx) => {
    const period = await tx.revenuePeriod.findUnique({
      where: { id: periodId },
      select: { id: true, project_id: true, status: true, available: true, label: true },
    });
    if (!period) throw notFound('That period');
    assertWithinScope(principal, period.project_id);
    if (period.status !== 'closed') throw conflict('Only a closed period can be approved.');

    const available = num(period.available);
    if (!(declared >= 0 && declared <= available)) {
      throw invalid(`${period.label} has ৳${available.toLocaleString('en-IN')} available to share.`, {
        declared: `Between ৳0 and ৳${available.toLocaleString('en-IN')}.`,
      });
    }

    return tx.revenuePeriod.update({
      where: { id: periodId },
      data: {
        status: 'approved',
        declared: new Prisma.Decimal(declared),
        approved_by: currentActorId(),
        approved_on: toDate(today()),
      },
      select: PERIOD_SELECT,
    });
  });
  return toPeriodDto(row);
}

/* ------------------------------------------------------------------ *
 * Declaring — the point of no return
 * ------------------------------------------------------------------ */

/**
 * Who owned the project on a date, and how much of a share each holding takes.
 *
 * Only purchases signed on or before the record date count, and each one is
 * read as it stood *then*: what had been paid by that day, and whether it was
 * held for the whole period. A purchase released or cancelled before the date
 * holds nothing, and its share goes back to the owners.
 */
async function capTableAt(
  client: Tx,
  projectId: string,
  policy: PolicyRow,
  recordDate: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ customers: (CustomerHolding & { sale_id: string; customer_id: string })[]; owners: OwnerSlice[] }> {
  const sales = await client.shareSale.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      status: { in: ['agreement_signed', 'fully_paid'] },
      agreement_date: { lte: toDate(recordDate) },
    },
    select: {
      id: true,
      customer_id: true,
      share_pct: true,
      total_price: true,
      agreement_date: true,
    },
  });

  const rows = sales as {
    id: string;
    customer_id: string;
    share_pct: Prisma.Decimal;
    total_price: Prisma.Decimal;
    agreement_date: Date | null;
  }[];

  /* what each holding had paid by the record date, net of reversals */
  const paid = await client.sharePayment.groupBy({
    by: ['sale_id'],
    where: { sale_id: { in: rows.map((r) => r.id) }, paid_on: { lte: toDate(recordDate) } },
    _sum: { principal: true },
  });
  const paidBySale = new Map<string, number>(
    (paid as { sale_id: string; _sum: { principal: Prisma.Decimal | null } }[]).map((p) => [
      p.sale_id,
      p._sum.principal?.toNumber() ?? 0,
    ]),
  );

  const customers = rows.map((row) => ({
    key: row.id,
    sale_id: row.id,
    customer_id: row.customer_id,
    ownership_pct: num(row.share_pct),
    factor: eligibilityFactor(
      policy.eligibility_rule,
      policy.prorate_days,
      {
        paid: paidBySale.get(row.id) ?? 0,
        price: num(row.total_price),
        held_from: row.agreement_date ? day(row.agreement_date) : periodStart,
      },
      periodStart,
      periodEnd,
    ),
  }));

  /*
   * The owners keep whatever customers do not hold. One line for now: who the
   * owners are, and in what proportion, is the Money module's (partners and
   * project investors), which is still on the interim layer. The amount is
   * already right; only its breakdown is waiting.
   */
  const held = customers.reduce((t, c) => t + c.ownership_pct, 0);
  const owners: OwnerSlice[] = [{ key: 'owners', share_pct: Math.max(0, 100 - held) }];

  return { customers, owners };
}

export interface DeclareResult {
  period: RevenuePeriodDto;
  allocations: ProfitAllocationDto[];
}

export interface ProfitAllocationDto {
  id: string;
  period_id: string;
  project_id: string;
  holder_type: string;
  customer_id: string | null;
  customer_name: string | null;
  share_sale_id: string | null;
  ownership_pct: number;
  eligibility_factor: number;
  gross: number;
  tax_withheld: number;
  adjusted_to_dues: number;
  net_credited: number;
  created_at: string;
}

/**
 * Declares the period: fixes the record date, reads who owned what on it, and
 * writes every holder's share — frozen.
 *
 * What a customer cannot take because of eligibility (the unpaid part of their
 * price, the days before they signed) goes to the owners, who carried that
 * part of the project. The lines always add back up to the declared amount:
 * the domain puts the rounding remainder on the largest owner so they do.
 */
export async function declarePeriod(
  principal: StaffPrincipal,
  periodId: string,
  recordDate?: string,
): Promise<DeclareResult> {
  const periodRow = await withTx(async (tx: Tx) => {
    const period = await tx.revenuePeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        project_id: true,
        status: true,
        declared: true,
        period_start: true,
        period_end: true,
        label: true,
      },
    });
    if (!period) throw notFound('That period');
    assertWithinScope(principal, period.project_id);
    if (period.status !== 'approved') {
      throw conflict('A period is declared once its statement has been approved.');
    }

    const declared = num(period.declared);
    if (declared <= 0) {
      throw conflict(`Nothing was declared for ${period.label}, so there is nothing to share.`);
    }

    const policy = await policyOf(tx, period.project_id);
    const start = day(period.period_start);
    const end = day(period.period_end);
    const date = recordDate ?? end;
    if (date < start) {
      throw invalid('The record date has to fall on or after the period started.', {
        record_date: `On or after ${start}.`,
      });
    }
    if (date > today()) {
      throw invalid('The record date cannot be in the future.', { record_date: 'Today or earlier.' });
    }

    const { customers, owners } = await capTableAt(
      tx,
      period.project_id,
      policy,
      date,
      start,
      end,
    );
    const lines = splitDeclared(declared, customers, owners, num(policy.tax_withholding_pct));
    const byKey = new Map(customers.map((c) => [c.key, c]));

    for (const line of lines) {
      const holding = byKey.get(line.key);

      /*
       * Plan §5.2: with "adjust against overdue dues first" on, a holder who
       * is behind on their own installments has their profit pay those first,
       * and only what is left reaches their balance. It is booked as a real
       * payment on the purchase, method `profit_adjustment` — no money moves,
       * but the installment is genuinely paid and the receipt says where from.
       */
      let adjusted = 0;
      if (holding && policy.adjust_overdue_first && line.net > 0) {
        adjusted = await payOverdueFromProfit(tx, holding.sale_id, line.net, date);
      }

      await tx.profitAllocation.create({
        data: {
          period_id: periodId,
          project_id: period.project_id,
          holder_type: holding ? ('customer' as const) : ('partner' as const),
          customer_id: holding?.customer_id ?? null,
          share_sale_id: holding?.sale_id ?? null,
          ownership_pct: new Prisma.Decimal(line.ownership_pct.toFixed(6)),
          eligibility_factor: new Prisma.Decimal(line.factor.toFixed(6)),
          gross: new Prisma.Decimal(line.gross),
          tax_withheld: new Prisma.Decimal(line.tax),
          adjusted_to_dues: new Prisma.Decimal(adjusted),
          net_credited: new Prisma.Decimal(line.net - adjusted),
          created_by: currentActorId(),
        },
      });
    }

    return tx.revenuePeriod.update({
      where: { id: periodId },
      data: {
        status: 'declared',
        record_date: toDate(date),
        declared_by: currentActorId(),
        declared_on: toDate(today()),
      },
      select: PERIOD_SELECT,
    });
  });

  return {
    period: toPeriodDto(periodRow),
    allocations: await listAllocations(principal, periodId),
  };
}

/**
 * Spends a holder's profit on their own overdue installments, and says how
 * much went that way.
 *
 * It goes through the share ledger like any other payment, which is the point:
 * the schedule, the receipts and the late fees all behave as they always do,
 * and the receipt names `profit_adjustment` so anybody reading the file can
 * see that no cash came in.
 */
async function payOverdueFromProfit(
  client: Tx,
  saleId: string,
  credit: number,
  paidOn: string,
): Promise<number> {
  const { dueNowOn, recordProfitAdjustment } = await import('./share-sale.service');
  const owed = await dueNowOn(client, saleId, paidOn);
  if (owed <= 0) return 0;
  const take = Math.min(Math.round(credit), Math.round(owed));
  if (take <= 0) return 0;
  await recordProfitAdjustment(client, saleId, take, paidOn);
  return take;
}

export async function listAllocations(
  principal: StaffPrincipal,
  periodId: string,
): Promise<ProfitAllocationDto[]> {
  const period = await prisma.revenuePeriod.findUnique({
    where: { id: periodId },
    select: { project_id: true },
  });
  if (!period) throw notFound('That period');
  assertWithinScope(principal, period.project_id);

  const rows = await prisma.profitAllocation.findMany({
    where: { period_id: periodId },
    orderBy: [{ holder_type: 'asc' }, { gross: 'desc' }],
    include: { customer: { select: { name: true } } },
  });

  return (
    rows as (Prisma.ProfitAllocationGetPayload<{ include: { customer: { select: { name: true } } } }>)[]
  ).map((row) => ({
    id: row.id,
    period_id: row.period_id,
    project_id: row.project_id,
    holder_type: row.holder_type,
    customer_id: row.customer_id,
    customer_name: row.customer?.name ?? null,
    share_sale_id: row.share_sale_id,
    ownership_pct: num(row.ownership_pct),
    eligibility_factor: num(row.eligibility_factor),
    gross: num(row.gross),
    tax_withheld: num(row.tax_withheld),
    adjusted_to_dues: num(row.adjusted_to_dues),
    net_credited: num(row.net_credited),
    created_at: row.created_at.toISOString(),
  }));
}

/**
 * What one investor has earned, across every project and period.
 *
 * Nothing has been paid out yet — withdrawals are the next batch — so the
 * balance is what has been credited. The shape is already the one a balance
 * needs, which is why it is said as `credited` rather than as `balance`.
 */
export async function customerEarnings(customerId: string) {
  const rows = await prisma.profitAllocation.findMany({
    where: { customer_id: customerId },
    orderBy: { created_at: 'desc' },
    include: {
      period: { select: { label: true, period_start: true, period_end: true, record_date: true } },
      project: { select: { id: true, name: true } },
    },
  });

  type Row = Prisma.ProfitAllocationGetPayload<{
    include: {
      period: { select: { label: true; period_start: true; period_end: true; record_date: true } };
      project: { select: { id: true; name: true } };
    };
  }>;

  const lines = (rows as Row[]).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_name: row.project.name,
    period_label: row.period.label,
    record_date: dayOrNull(row.period.record_date),
    ownership_pct: num(row.ownership_pct),
    eligibility_factor: num(row.eligibility_factor),
    gross: num(row.gross),
    tax_withheld: num(row.tax_withheld),
    net_credited: num(row.net_credited),
  }));

  return {
    lines,
    totals: {
      gross: lines.reduce((t, l) => t + l.gross, 0),
      tax_withheld: lines.reduce((t, l) => t + l.tax_withheld, 0),
      credited: lines.reduce((t, l) => t + l.net_credited, 0),
    },
  };
}
