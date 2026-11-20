import { Prisma } from '@prisma/client';
import {
  buildLines,
  chainOn,
  planForSale,
  planProblem,
  payoutMath,
  stageReachedOn,
  type LineDraft,
  type SaleProgress,
} from '@/lib/domain/commission';
import { money } from '@/lib/domain/money';
import type {
  CommissionOverride,
  CommissionPlan as DomainPlan,
  CommissionStage,
  OrgMember as DomainMember,
  OrgMove as DomainMove,
} from '@/lib/db/types';
import { currentActorId } from '../audit/audit';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';
import { ORG_DESIGNATION } from './org.service';

/**
 * Commission — what a sale earns whoever sold it, and the people above them
 * (REVENUE-SHARE-PLAN.md §7).
 *
 * The shape of it: a **plan** says how much and in what stages; when a sale
 * gets a seller the plan in force is attached and the chain is snapshotted, so
 * one **line** per person per stage exists from the start as `pending`; the
 * payment ledger reaching a stage turns its lines `earned`; Accounts approves
 * them; a **payout** pays a member everything approved at once.
 *
 * Nothing in here marks a stage by hand. `reconcile` reads the sales and their
 * receipts and brings the lines level with what the ledgers already say —
 * which is why it is idempotent, why it runs before every read, and why a
 * reversed receipt takes an unapproved stage back on its own.
 *
 * The arithmetic is all in `src/lib/domain/commission.ts`: which plan applies,
 * the chain on a date, how a person's total splits over the stages, what a
 * payout comes to. This file decides when those sums may be done and what they
 * are frozen into (AGENTS.md).
 */

/* ------------------------------------------------------------------ *
 * What the wire carries
 * ------------------------------------------------------------------ */

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  applies_to: true,
  project_id: true,
  offering_id: true,
  seller_basis: true,
  seller_value: true,
  stages: true,
  overrides: true,
  cancel_rule: true,
  effective_from: true,
  effective_to: true,
  status: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.CommissionPlanSelect;

type PlanRow = Prisma.CommissionPlanGetPayload<{ select: typeof PLAN_SELECT }>;

const LINE_SELECT = {
  id: true,
  plan_id: true,
  sale_kind: true,
  share_sale_id: true,
  project_id: true,
  member_id: true,
  role: true,
  designation_at_sale: true,
  level: true,
  stage_key: true,
  stage_label: true,
  stage_seq: true,
  sale_date: true,
  sale_amount: true,
  amount: true,
  status: true,
  earned_on: true,
  approved_on: true,
  payout_id: true,
  to_recover: true,
  recovered_payout_id: true,
  void_reason: true,
  created_at: true,
} satisfies Prisma.CommissionLineSelect;

type LineRow = Prisma.CommissionLineGetPayload<{ select: typeof LINE_SELECT }>;

export type CommissionLineStatus = LineRow['status'];
export type CommissionPlanStatus = PlanRow['status'];

const num = (value: Prisma.Decimal | null) => (value === null ? 0 : value.toNumber());
const day = (value: Date) => value.toISOString().slice(0, 10);
const dayOrNull = (value: Date | null) => (value === null ? null : day(value));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export interface CommissionPlanDto {
  id: string;
  code: string;
  name: string;
  applies_to: string;
  project_id: string | null;
  project_name: string | null;
  offering_id: string | null;
  offering_code: string | null;
  seller_basis: string;
  seller_value: number;
  stages: CommissionStage[];
  overrides: CommissionOverride[];
  cancel_rule: string;
  effective_from: string;
  effective_to: string | null;
  status: CommissionPlanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** how many sales have earned against this plan — a plan with any cannot be rewritten */
  sales: number;
}

/** The stages and overrides out of JSONB, in the shape the domain expects. */
const stagesOf = (value: Prisma.JsonValue): CommissionStage[] =>
  Array.isArray(value) ? (value as unknown as CommissionStage[]) : [];
const overridesOf = (value: Prisma.JsonValue): CommissionOverride[] =>
  Array.isArray(value) ? (value as unknown as CommissionOverride[]) : [];

function toPlanDto(
  row: PlanRow,
  extra: {
    project_name?: string | null;
    offering_code?: string | null;
    sales?: number;
  } = {},
): CommissionPlanDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    applies_to: row.applies_to,
    project_id: row.project_id,
    project_name: extra.project_name ?? null,
    offering_id: row.offering_id,
    offering_code: extra.offering_code ?? null,
    seller_basis: row.seller_basis,
    seller_value: num(row.seller_value),
    stages: stagesOf(row.stages),
    overrides: overridesOf(row.overrides),
    cancel_rule: row.cancel_rule,
    effective_from: day(row.effective_from),
    effective_to: dayOrNull(row.effective_to),
    status: row.status,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    sales: extra.sales ?? 0,
  };
}

export interface CommissionLineDto {
  id: string;
  plan_id: string;
  plan_code: string;
  sale_kind: string;
  share_sale_id: string | null;
  sale_code: string;
  project_id: string | null;
  project_name: string | null;
  customer_name: string | null;
  member_id: string;
  member_name: string;
  member_code: string;
  role: string;
  designation_at_sale: string;
  level: number;
  stage_key: string;
  stage_label: string;
  stage_seq: number;
  sale_date: string;
  sale_amount: number;
  amount: number;
  status: CommissionLineStatus;
  earned_on: string | null;
  approved_on: string | null;
  payout_id: string | null;
  to_recover: boolean;
  recovered_payout_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface CommissionTotals {
  pending: number;
  earned: number;
  approved: number;
  paid: number;
  void: number;
  recovered: number;
  /** paid commission on cancelled sales, still to come off a payout */
  to_recover: number;
}

export function totalsOf(lines: Array<{ status: string; amount: number; to_recover: boolean }>): CommissionTotals {
  const totals: CommissionTotals = {
    pending: 0,
    earned: 0,
    approved: 0,
    paid: 0,
    void: 0,
    recovered: 0,
    to_recover: 0,
  };
  for (const line of lines) {
    const key = line.status as keyof CommissionTotals;
    if (key in totals) totals[key] = money(totals[key] + line.amount);
    if (line.to_recover && line.status === 'paid') {
      totals.to_recover = money(totals.to_recover + line.amount);
    }
  }
  return totals;
}

/* ------------------------------------------------------------------ *
 * Bringing the lines level with the ledgers
 * ------------------------------------------------------------------ */

interface SaleFacts {
  id: string;
  project_id: string | null;
  offering_id: string | null;
  date: string;
  amount: number;
  units: number;
  sold_by: string | null;
  /** released or cancelled: what was sold went back */
  ended: boolean;
  progress: SaleProgress;
}

/**
 * Every sale the engine can earn on.
 *
 * Phase 1 sells shares only. The plan keeps `applies_to` and the line keeps
 * `sale_kind`, so the flat and plot arm slots back in with the sales module in
 * Phase 2 without touching the plans or the lines already earned (AGENTS.md).
 */
async function saleFacts(client: Tx, saleId?: string): Promise<SaleFacts[]> {
  const sales = (await client.shareSale.findMany({
    where: { deleted_at: null, ...(saleId ? { id: saleId } : {}) },
    select: {
      id: true,
      project_id: true,
      offering_id: true,
      status: true,
      shares: true,
      total_price: true,
      down_payment: true,
      reserved_on: true,
      agreement_date: true,
      certificate_date: true,
      sold_by_member_id: true,
      payments: { select: { paid_on: true, principal: true } },
    },
  })) as Array<{
    id: string;
    project_id: string;
    offering_id: string;
    status: string;
    shares: number;
    total_price: Prisma.Decimal;
    down_payment: Prisma.Decimal;
    reserved_on: Date;
    agreement_date: Date | null;
    certificate_date: Date | null;
    sold_by_member_id: string | null;
    payments: Array<{ paid_on: Date; principal: Prisma.Decimal }>;
  }>;

  return sales.map((sale) => ({
    id: sale.id,
    project_id: sale.project_id,
    offering_id: sale.offering_id,
    /*
     * The agreement date where there is one, the reservation otherwise: the
     * plan in force and the chain are both read on this day, so it has to be
     * the day the sale became real rather than the day it was typed.
     */
    date: sale.agreement_date ? day(sale.agreement_date) : day(sale.reserved_on),
    amount: num(sale.total_price),
    units: sale.shares,
    sold_by: sale.sold_by_member_id,
    ended: sale.status === 'released' || sale.status === 'cancelled',
    progress: {
      price: num(sale.total_price),
      agreement_on: sale.status === 'reserved' ? null : dayOrNull(sale.agreement_date),
      down_payment: num(sale.down_payment),
      /*
       * Principal only, and net of reversals: a reversing receipt is a
       * negative row, so a stage a reversed payment had reached comes back
       * below its threshold on its own.
       */
      payments: sale.payments.map((payment) => ({
        date: day(payment.paid_on),
        amount: num(payment.principal),
      })),
      handover_on: dayOrNull(sale.certificate_date),
    },
  }));
}

/** The plans and the tree, in the shapes `domain/commission.ts` takes. */
async function engineInputs(client: Tx) {
  const [plans, members, moves, designations] = await Promise.all([
    client.commissionPlan.findMany({ where: { deleted_at: null }, select: PLAN_SELECT }),
    client.orgMember.findMany({
      select: {
        id: true,
        parent_id: true,
        designation_id: true,
        joined_on: true,
        left_on: true,
      },
    }),
    client.orgMove.findMany({
      select: {
        member_id: true,
        from_parent_id: true,
        to_parent_id: true,
        effective_date: true,
        created_at: true,
      },
      orderBy: [{ effective_date: 'asc' }, { created_at: 'asc' }],
    }),
    client.lookupValue.findMany({
      where: { category: ORG_DESIGNATION },
      select: { id: true, value: true },
    }),
  ]);

  /*
   * The domain works in plain ISO strings, which is the whole reason it can be
   * shared with the browser. Decimal and Date are converted here, once, at the
   * service boundary (NEXT-SESSION.md).
   */
  const domainPlans = (plans as PlanRow[]).map(
    (row) =>
      ({
        id: row.id,
        code: row.code,
        name: row.name,
        applies_to: row.applies_to,
        project_id: row.project_id,
        offering_id: row.offering_id,
        seller_basis: row.seller_basis,
        seller_value: num(row.seller_value),
        stages: stagesOf(row.stages),
        overrides: overridesOf(row.overrides),
        cancel_rule: row.cancel_rule,
        effective_from: day(row.effective_from),
        effective_to: dayOrNull(row.effective_to),
        status: row.status,
      }) as unknown as DomainPlan,
  );

  const domainMembers = (
    members as Array<{
      id: string;
      parent_id: string | null;
      designation_id: string;
      joined_on: Date;
      left_on: Date | null;
    }>
  ).map(
    (row) =>
      ({
        id: row.id,
        parent_id: row.parent_id,
        designation_id: row.designation_id,
        joined_on: day(row.joined_on),
        left_on: dayOrNull(row.left_on),
      }) as unknown as DomainMember,
  );

  const domainMoves = (
    moves as Array<{
      member_id: string;
      from_parent_id: string | null;
      to_parent_id: string | null;
      effective_date: Date;
      created_at: Date;
    }>
  ).map(
    (row) =>
      ({
        member_id: row.member_id,
        from_parent_id: row.from_parent_id,
        to_parent_id: row.to_parent_id,
        effective_date: day(row.effective_date),
        created_at: row.created_at.toISOString(),
      }) as unknown as DomainMove,
  );

  const label = new Map(
    (designations as Array<{ id: string; value: string }>).map((row) => [row.id, row.value]),
  );

  return {
    plans: domainPlans,
    members: domainMembers,
    moves: domainMoves,
    designationLabel: (id: string) => label.get(id) ?? '—',
  };
}

/**
 * Brings every commission line level with the sales and their receipts.
 *
 * Creates the lines of a sale that has a seller and a plan, earns the stages
 * the money has reached, takes an unapproved stage back when a receipt was
 * reversed, and applies the plan's cancel rule to a sale that ended.
 *
 * Idempotent, so it is safe to run before every read — which is how a stage is
 * "released automatically" (plan §7.2 step 2) without a background job. It is
 * also why it never touches a line that has been approved or paid: those are
 * promises somebody has made, and only a cancellation may disturb them.
 */
export async function reconcile(saleId?: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const [facts, inputs] = await Promise.all([saleFacts(tx, saleId), engineInputs(tx)]);
    if (facts.length === 0) return;

    const existing = (await tx.commissionLine.findMany({
      where: { share_sale_id: { in: facts.map((fact) => fact.id) } },
      select: {
        id: true,
        share_sale_id: true,
        plan_id: true,
        member_id: true,
        role: true,
        stage_key: true,
        status: true,
        earned_on: true,
        to_recover: true,
      },
    })) as Array<{
      id: string;
      share_sale_id: string | null;
      plan_id: string;
      member_id: string;
      role: string;
      stage_key: string;
      status: string;
      earned_on: Date | null;
      to_recover: boolean;
    }>;

    const bySale = new Map<string, typeof existing>();
    for (const line of existing) {
      const key = line.share_sale_id ?? '';
      bySale.set(key, [...(bySale.get(key) ?? []), line]);
    }
    const planById = new Map(inputs.plans.map((plan) => [plan.id, plan]));

    for (const sale of facts) {
      let mine = bySale.get(sale.id) ?? [];

      /*
       * The seller changed while nothing had been earned yet, so the old draft
       * is thrown away rather than left pointing at the wrong person. Once
       * anything is earned, `setSoldBy` refuses the change instead.
       */
      const allPending = mine.length > 0 && mine.every((line) => line.status === 'pending');
      const seller = mine.find((line) => line.role === 'seller')?.member_id ?? null;
      if (allPending && seller !== sale.sold_by) {
        await tx.commissionLine.deleteMany({ where: { id: { in: mine.map((l) => l.id) } } });
        mine = [];
      }

      if (mine.length === 0) {
        if (!sale.sold_by || sale.ended) continue;
        const plan = planForSale(inputs.plans, {
          kind: 'share',
          project_id: sale.project_id,
          offering_id: sale.offering_id,
          date: sale.date,
        });
        if (!plan) continue;

        const chain = chainOn(sale.sold_by, inputs.members, inputs.moves, sale.date);
        const drafts: LineDraft[] = buildLines(plan, chain, sale, inputs.designationLabel);
        if (drafts.length === 0) continue;

        await tx.commissionLine.createMany({
          data: drafts.map((draft) => ({
            plan_id: plan.id,
            sale_kind: 'share' as const,
            share_sale_id: sale.id,
            project_id: sale.project_id,
            member_id: draft.member_id,
            role: draft.role,
            designation_at_sale: draft.designation_at_sale,
            level: draft.level,
            stage_key: draft.stage_key,
            stage_label: draft.stage_label,
            stage_seq: draft.stage_seq,
            sale_date: toDate(sale.date),
            sale_amount: sale.amount,
            amount: draft.amount,
            status: 'pending' as const,
            created_by: currentActorId(),
          })),
        });

        mine = (await tx.commissionLine.findMany({
          where: { share_sale_id: sale.id },
          select: {
            id: true,
            share_sale_id: true,
            plan_id: true,
            member_id: true,
            role: true,
            stage_key: true,
            status: true,
            earned_on: true,
            to_recover: true,
          },
        })) as typeof existing;
      }

      for (const line of mine) {
        const plan = planById.get(line.plan_id);
        const stage = plan?.stages.find((s) => s.key === line.stage_key);
        let changes: Prisma.CommissionLineUncheckedUpdateInput | null = null;

        if (sale.ended) {
          if (line.status === 'pending' || line.status === 'earned' || line.status === 'approved') {
            changes = { status: 'void', void_reason: 'The sale was cancelled before this was paid' };
          } else if (line.status === 'paid' && plan?.cancel_rule === 'recover' && !line.to_recover) {
            changes = { to_recover: true };
          }
        } else if (stage) {
          const reached = stageReachedOn(stage, sale.progress);
          const earned = dayOrNull(line.earned_on);
          if (line.status === 'pending' && reached) {
            changes = { status: 'earned', earned_on: toDate(reached) };
          } else if (line.status === 'earned' && !reached) {
            // a reversed receipt takes an unapproved stage back
            changes = { status: 'pending', earned_on: null };
          } else if (line.status === 'earned' && reached && reached !== earned) {
            changes = { earned_on: toDate(reached) };
          }
        }

        if (changes) await tx.commissionLine.update({ where: { id: line.id }, data: changes });
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

export async function listPlans(): Promise<CommissionPlanDto[]> {
  const rows = (await prisma.commissionPlan.findMany({
    select: PLAN_SELECT,
    orderBy: [{ status: 'asc' }, { effective_from: 'desc' }],
  })) as PlanRow[];
  if (rows.length === 0) return [];

  const [projects, offerings, counts] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true } }),
    prisma.shareOffering.findMany({ select: { id: true, code: true } }),
    prisma.commissionLine.groupBy({
      by: ['plan_id'],
      _count: { _all: true },
    }),
  ]);
  const projectName = new Map(
    (projects as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
  );
  const offeringCode = new Map(
    (offerings as Array<{ id: string; code: string }>).map((row) => [row.id, row.code]),
  );
  const used = new Map(
    (counts as Array<{ plan_id: string; _count: { _all: number } }>).map((row) => [
      row.plan_id,
      row._count._all,
    ]),
  );

  return rows.map((row) =>
    toPlanDto(row, {
      project_name: row.project_id ? (projectName.get(row.project_id) ?? null) : null,
      offering_code: row.offering_id ? (offeringCode.get(row.offering_id) ?? null) : null,
      sales: used.get(row.id) ?? 0,
    }),
  );
}

export async function getPlan(id: string): Promise<CommissionPlanDto> {
  const row = await prisma.commissionPlan.findUnique({ where: { id }, select: PLAN_SELECT });
  if (!row) throw notFound('That commission plan');
  const all = await listPlans();
  return all.find((plan) => plan.id === id) ?? toPlanDto(row);
}

export interface PlanInput {
  name?: string;
  applies_to?: 'share_sale' | 'booking';
  project_id?: string | null;
  offering_id?: string | null;
  seller_basis?: 'pct' | 'per_share' | 'per_sale';
  seller_value?: number;
  stages?: CommissionStage[];
  overrides?: CommissionOverride[];
  cancel_rule?: 'recover' | 'write_off';
  effective_from?: string;
  effective_to?: string | null;
  status?: 'draft' | 'active' | 'retired';
  notes?: string | null;
}

/**
 * Checks a plan with the same function the browser previews it with, so the
 * two cannot disagree about what is wrong with it.
 *
 * A draft may be saved half-finished — somebody is still writing it. What goes
 * `active` has to add up, because from that moment it decides what people are
 * owed.
 */
function assertUsable(plan: {
  name: string;
  seller_value: number;
  stages: CommissionStage[];
  overrides: CommissionOverride[];
  effective_from: string;
  effective_to: string | null;
}): void {
  const problem = planProblem(plan);
  if (problem) throw invalid(problem);
}

export async function createPlan(input: PlanInput): Promise<CommissionPlanDto> {
  const name = input.name?.trim();
  if (!name) throw invalid('A plan needs a name.', { name: 'What is it called?' });
  if (!input.effective_from) {
    throw invalid('Enter the date the plan starts.', { effective_from: 'From when?' });
  }

  const stages = input.stages ?? [];
  const overrides = input.overrides ?? [];
  const status = input.status ?? 'draft';
  if (status === 'active') {
    assertUsable({
      name,
      seller_value: input.seller_value ?? 0,
      stages,
      overrides,
      effective_from: input.effective_from,
      effective_to: input.effective_to ?? null,
    });
  }

  const row = await withTx(async (tx: Tx) => {
    if (input.project_id) await assertProject(tx, input.project_id);
    if (input.offering_id) await assertOffering(tx, input.offering_id);

    return tx.commissionPlan.create({
      data: {
        code: await nextCode(tx, 'commission_plan'),
        name,
        applies_to: input.applies_to ?? 'share_sale',
        project_id: input.project_id ?? null,
        offering_id: input.offering_id ?? null,
        seller_basis: input.seller_basis ?? 'pct',
        seller_value: input.seller_value ?? 0,
        stages: stages as unknown as Prisma.InputJsonValue,
        overrides: overrides as unknown as Prisma.InputJsonValue,
        cancel_rule: input.cancel_rule ?? 'recover',
        effective_from: toDate(input.effective_from!),
        effective_to: input.effective_to ? toDate(input.effective_to) : null,
        status,
        notes: input.notes?.trim() || null,
        created_by: currentActorId(),
      },
      select: { id: true },
    });
  });

  return getPlan(row.id);
}

async function assertProject(client: Tx, id: string): Promise<void> {
  const row = await client.project.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw invalid('That project no longer exists.', { project_id: 'Pick another.' });
}

async function assertOffering(client: Tx, id: string): Promise<void> {
  const row = await client.shareOffering.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw invalid('That round no longer exists.', { offering_id: 'Pick another.' });
}

/**
 * Changes a plan.
 *
 * What a plan says is only rewritable while nothing has earned against it:
 * once lines exist they were built from its stages and its rates, and editing
 * those underneath them would make the lines unexplainable. After that only
 * the name, the notes, the end date and the status may move — retiring a plan
 * and writing a new one is the way to change the terms, which is also what
 * `effective_from` is for.
 */
export async function updatePlan(id: string, input: PlanInput): Promise<CommissionPlanDto> {
  await withTx(async (tx: Tx) => {
    const current = (await tx.commissionPlan.findUnique({
      where: { id },
      select: PLAN_SELECT,
    })) as PlanRow | null;
    if (!current) throw notFound('That commission plan');

    const earned = await tx.commissionLine.count({ where: { plan_id: id } });
    const touchesTerms =
      input.applies_to !== undefined ||
      input.project_id !== undefined ||
      input.offering_id !== undefined ||
      input.seller_basis !== undefined ||
      input.seller_value !== undefined ||
      input.stages !== undefined ||
      input.overrides !== undefined ||
      input.effective_from !== undefined;

    if (earned > 0 && touchesTerms) {
      throw conflict(
        `${earned} commission line${earned === 1 ? '' : 's'} were built from this plan. Retire it and write a new one instead of changing its terms.`,
      );
    }

    const next = {
      name: input.name?.trim() ?? current.name,
      seller_value: input.seller_value ?? num(current.seller_value),
      stages: input.stages ?? stagesOf(current.stages),
      overrides: input.overrides ?? overridesOf(current.overrides),
      effective_from: input.effective_from ?? day(current.effective_from),
      effective_to:
        input.effective_to === undefined ? dayOrNull(current.effective_to) : input.effective_to,
    };
    if ((input.status ?? current.status) === 'active') assertUsable(next);

    if (input.project_id) await assertProject(tx, input.project_id);
    if (input.offering_id) await assertOffering(tx, input.offering_id);

    await tx.commissionPlan.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        applies_to: input.applies_to,
        project_id: input.project_id === undefined ? undefined : (input.project_id || null),
        offering_id: input.offering_id === undefined ? undefined : (input.offering_id || null),
        seller_basis: input.seller_basis,
        seller_value: input.seller_value,
        stages:
          input.stages === undefined ? undefined : (input.stages as unknown as Prisma.InputJsonValue),
        overrides:
          input.overrides === undefined
            ? undefined
            : (input.overrides as unknown as Prisma.InputJsonValue),
        cancel_rule: input.cancel_rule,
        effective_from: input.effective_from ? toDate(input.effective_from) : undefined,
        effective_to:
          input.effective_to === undefined
            ? undefined
            : input.effective_to
              ? toDate(input.effective_to)
              : null,
        status: input.status,
        notes: input.notes === undefined ? undefined : (input.notes?.trim() || null),
      },
    });
  });

  return getPlan(id);
}

/** Deletes a plan nothing has earned against. Anything else is retired. */
export async function deletePlan(id: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const plan = await tx.commissionPlan.findUnique({ where: { id }, select: { id: true } });
    if (!plan) throw notFound('That commission plan');

    const lines = await tx.commissionLine.count({ where: { plan_id: id } });
    if (lines > 0) {
      throw conflict(
        `${lines} commission line${lines === 1 ? '' : 's'} came from this plan. Retire it instead.`,
      );
    }
    await tx.commissionPlan.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}

/* ------------------------------------------------------------------ *
 * Lines
 * ------------------------------------------------------------------ */

interface LineContext {
  planCode: Map<string, string>;
  member: Map<string, { name: string; code: string }>;
  project: Map<string, string>;
  sale: Map<string, { code: string; agreement_no: string | null; customer_name: string }>;
}

async function lineContext(lines: LineRow[]): Promise<LineContext> {
  const planIds = [...new Set(lines.map((line) => line.plan_id))];
  const memberIds = [...new Set(lines.map((line) => line.member_id))];
  const projectIds = [
    ...new Set(lines.map((line) => line.project_id).filter((id): id is string => Boolean(id))),
  ];
  const saleIds = [
    ...new Set(lines.map((line) => line.share_sale_id).filter((id): id is string => Boolean(id))),
  ];

  const [plans, members, projects, sales] = await Promise.all([
    prisma.commissionPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, code: true } }),
    prisma.orgMember.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, code: true },
    }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
    prisma.shareSale.findMany({
      where: { id: { in: saleIds } },
      select: {
        id: true,
        code: true,
        agreement_no: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  return {
    planCode: new Map(
      (plans as Array<{ id: string; code: string }>).map((row) => [row.id, row.code]),
    ),
    member: new Map(
      (members as Array<{ id: string; name: string; code: string }>).map((row) => [
        row.id,
        { name: row.name, code: row.code },
      ]),
    ),
    project: new Map(
      (projects as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
    ),
    sale: new Map(
      (
        sales as Array<{
          id: string;
          code: string;
          agreement_no: string | null;
          customer: { name: string };
        }>
      ).map((row) => [
        row.id,
        { code: row.code, agreement_no: row.agreement_no, customer_name: row.customer.name },
      ]),
    ),
  };
}

function toLineDto(row: LineRow, context: LineContext): CommissionLineDto {
  const sale = row.share_sale_id ? context.sale.get(row.share_sale_id) : undefined;
  const member = context.member.get(row.member_id);
  return {
    id: row.id,
    plan_id: row.plan_id,
    plan_code: context.planCode.get(row.plan_id) ?? '—',
    sale_kind: row.sale_kind,
    share_sale_id: row.share_sale_id,
    // the agreement number where the purchase has one: that is what people quote
    sale_code: sale?.agreement_no || sale?.code || '—',
    project_id: row.project_id,
    project_name: row.project_id ? (context.project.get(row.project_id) ?? null) : null,
    customer_name: sale?.customer_name ?? null,
    member_id: row.member_id,
    member_name: member?.name ?? '—',
    member_code: member?.code ?? '—',
    role: row.role,
    designation_at_sale: row.designation_at_sale,
    level: row.level,
    stage_key: row.stage_key,
    stage_label: row.stage_label,
    stage_seq: row.stage_seq,
    sale_date: day(row.sale_date),
    sale_amount: num(row.sale_amount),
    amount: num(row.amount),
    status: row.status,
    earned_on: dayOrNull(row.earned_on),
    approved_on: dayOrNull(row.approved_on),
    payout_id: row.payout_id,
    to_recover: row.to_recover,
    recovered_payout_id: row.recovered_payout_id,
    void_reason: row.void_reason,
    created_at: row.created_at.toISOString(),
  };
}

export interface LineFilters {
  member_id?: string;
  project_id?: string;
  share_sale_id?: string;
  status?: CommissionLineStatus;
  role?: 'seller' | 'override';
  /** this member and everybody under them — a lead looking at their branch */
  team_of?: string;
}

export interface CommissionLinePage {
  rows: CommissionLineDto[];
  total: number;
  page: number;
  page_size: number;
  totals: CommissionTotals;
}

/**
 * The commission list. Reconciles first, so what it shows is what the ledgers
 * already say rather than what somebody last remembered to refresh.
 */
export async function listLines(
  filters: LineFilters = {},
  paging: { page?: number; page_size?: number } = {},
): Promise<CommissionLinePage> {
  await reconcile(filters.share_sale_id);

  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(500, Math.max(1, paging.page_size ?? 100));

  const where: Prisma.CommissionLineWhereInput = {};
  if (filters.member_id) where.member_id = filters.member_id;
  if (filters.project_id) where.project_id = filters.project_id;
  if (filters.share_sale_id) where.share_sale_id = filters.share_sale_id;
  if (filters.status) where.status = filters.status;
  if (filters.role) where.role = filters.role;
  if (filters.team_of) {
    const { teamIds } = await import('./org.service');
    where.member_id = { in: [filters.team_of, ...(await teamIds(filters.team_of))] };
  }

  const [rows, total, all] = await Promise.all([
    prisma.commissionLine.findMany({
      where,
      select: LINE_SELECT,
      orderBy: [{ sale_date: 'desc' }, { level: 'asc' }, { stage_seq: 'asc' }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.commissionLine.count({ where }),
    /*
     * The totals are over everything the filters match, not over the page: the
     * figure a person reads at the top of the screen is "what is owed", and a
     * total that changed when they turned the page would be worse than none.
     */
    prisma.commissionLine.findMany({
      where,
      select: { status: true, amount: true, to_recover: true },
    }),
  ]);

  const context = await lineContext(rows as LineRow[]);
  return {
    rows: (rows as LineRow[]).map((row) => toLineDto(row, context)),
    total,
    page,
    page_size,
    totals: totalsOf(
      (all as Array<{ status: string; amount: Prisma.Decimal; to_recover: boolean }>).map((row) => ({
        status: row.status,
        amount: num(row.amount),
        to_recover: row.to_recover,
      })),
    ),
  };
}

export interface StatementSale {
  key: string;
  share_sale_id: string | null;
  sale_code: string;
  sale_date: string;
  sale_amount: number;
  customer_name: string | null;
  project_name: string | null;
  role: string;
  designation_at_sale: string;
  lines: CommissionLineDto[];
  totals: CommissionTotals;
  total: number;
}

export interface MemberStatement {
  member: { id: string; code: string; name: string };
  sales: StatementSale[];
  totals: CommissionTotals;
}

/** One member's statement: each sale, its stages, what is released and what is to come. */
export async function memberStatement(memberId: string): Promise<MemberStatement> {
  await reconcile();

  const member = await prisma.orgMember.findUnique({
    where: { id: memberId },
    select: { id: true, code: true, name: true },
  });
  if (!member) throw notFound('That member');

  const rows = (await prisma.commissionLine.findMany({
    where: { member_id: memberId },
    select: LINE_SELECT,
    orderBy: [{ sale_date: 'desc' }, { stage_seq: 'asc' }],
  })) as LineRow[];
  const context = await lineContext(rows);
  const dtos = rows.map((row) => toLineDto(row, context));

  const grouped = new Map<string, CommissionLineDto[]>();
  for (const line of dtos) {
    // one block per sale per role: somebody can be the seller on one and an upline on another
    const key = `${line.share_sale_id}:${line.role}`;
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }

  const sales: StatementSale[] = [...grouped.entries()]
    .map(([key, lines]) => {
      const first = lines[0]!;
      return {
        key,
        share_sale_id: first.share_sale_id,
        sale_code: first.sale_code,
        sale_date: first.sale_date,
        sale_amount: first.sale_amount,
        customer_name: first.customer_name,
        project_name: first.project_name,
        role: first.role,
        designation_at_sale: first.designation_at_sale,
        lines: [...lines].sort((a, b) => a.stage_seq - b.stage_seq),
        totals: totalsOf(lines),
        total: money(lines.reduce((sum, line) => sum + line.amount, 0)),
      };
    })
    .sort((a, b) => b.sale_date.localeCompare(a.sale_date));

  return { member, sales, totals: totalsOf(dtos) };
}

/** The lines of one purchase, for its own page. */
export async function linesForSale(saleId: string): Promise<CommissionLineDto[]> {
  const page = await listLines({ share_sale_id: saleId }, { page_size: 500 });
  return page.rows.sort((a, b) => a.level - b.level || a.stage_seq - b.stage_seq);
}

/**
 * Accounts accepts earned commission — it becomes payable.
 *
 * Only `earned` lines: a `pending` one has not happened yet, and approving it
 * would promise money on a stage the ledger has not reached.
 */
export async function approveLines(ids: string[]): Promise<{ approved: number }> {
  if (ids.length === 0) throw invalid('Pick the commission to approve.');

  const approved = await withTx(async (tx: Tx) => {
    const lines = (await tx.commissionLine.findMany({
      where: { id: { in: ids }, status: 'earned' },
      select: { id: true },
    })) as Array<{ id: string }>;
    if (lines.length === 0) throw conflict('Only earned commission can be approved.');

    await tx.commissionLine.updateMany({
      where: { id: { in: lines.map((line) => line.id) } },
      data: {
        status: 'approved',
        approved_by: currentActorId(),
        approved_on: new Date(),
      },
    });
    return lines.length;
  });

  return { approved };
}

/* ------------------------------------------------------------------ *
 * Payouts
 * ------------------------------------------------------------------ */

export interface PayoutPreview {
  member: { id: string; code: string; name: string };
  lines: CommissionLineDto[];
  lines_total: number;
  /** paid commission on cancelled sales, waiting to come off a payout */
  to_recover: number;
  /** what this payout would actually take back — whole lines, as far as it covers them */
  recovering: CommissionLineDto[];
  recover_now: number;
}

/**
 * Whole lines only, smallest first, as far as the approved total covers them.
 *
 * Splitting a line would leave a part-recovered row that no screen could
 * explain; carrying the rest to the next payout is both simpler and what the
 * plan says ("recovered from future commission").
 */
function takeRecoveries(recoveries: CommissionLineDto[], linesTotal: number): CommissionLineDto[] {
  const taking: CommissionLineDto[] = [];
  let taken = 0;
  for (const line of [...recoveries].sort((a, b) => a.amount - b.amount)) {
    if (taken + line.amount > linesTotal + 0.005) continue;
    taking.push(line);
    taken = money(taken + line.amount);
  }
  return taking;
}

async function previewFor(
  member: { id: string; code: string; name: string },
  rows: LineRow[],
  context: LineContext,
): Promise<PayoutPreview> {
  const mine = rows.filter((row) => row.member_id === member.id).map((row) => toLineDto(row, context));
  const lines = mine.filter((line) => line.status === 'approved');
  const recoveries = mine.filter((line) => line.status === 'paid' && line.to_recover);
  const lines_total = money(lines.reduce((sum, line) => sum + line.amount, 0));
  const recovering = takeRecoveries(recoveries, lines_total);

  return {
    member,
    lines,
    lines_total,
    to_recover: money(recoveries.reduce((sum, line) => sum + line.amount, 0)),
    recovering,
    recover_now: money(recovering.reduce((sum, line) => sum + line.amount, 0)),
  };
}

/** Members with approved commission waiting to be paid, most owed first. */
export async function payableMembers(): Promise<PayoutPreview[]> {
  await reconcile();

  const rows = (await prisma.commissionLine.findMany({
    where: { OR: [{ status: 'approved' }, { status: 'paid', to_recover: true }] },
    select: LINE_SELECT,
  })) as LineRow[];
  if (rows.length === 0) return [];

  const context = await lineContext(rows);
  const members = (await prisma.orgMember.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.member_id))] } },
    select: { id: true, code: true, name: true },
  })) as Array<{ id: string; code: string; name: string }>;

  const previews = await Promise.all(
    members.map((member) => previewFor(member, rows, context)),
  );
  return previews
    .filter((preview) => preview.lines.length > 0)
    .sort((a, b) => b.lines_total - a.lines_total);
}

export async function payoutPreview(memberId: string): Promise<PayoutPreview> {
  await reconcile();

  const member = await prisma.orgMember.findUnique({
    where: { id: memberId },
    select: { id: true, code: true, name: true },
  });
  if (!member) throw notFound('That member');

  const rows = (await prisma.commissionLine.findMany({
    where: { member_id: memberId },
    select: LINE_SELECT,
  })) as LineRow[];
  return previewFor(member, rows, await lineContext(rows));
}

export interface PayoutDto {
  id: string;
  code: string;
  member_id: string;
  member_name: string;
  member_code: string;
  lines_total: number;
  recovered: number;
  tax_pct: number;
  tax_withheld: number;
  net: number;
  account_id: string | null;
  paid_on: string;
  reference_no: string | null;
  notes: string | null;
  line_count: number;
  created_at: string;
}

const PAYOUT_SELECT = {
  id: true,
  code: true,
  member_id: true,
  lines_total: true,
  recovered: true,
  tax_pct: true,
  tax_withheld: true,
  net: true,
  account_id: true,
  paid_on: true,
  reference_no: true,
  notes: true,
  created_at: true,
  member: { select: { name: true, code: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.CommissionPayoutSelect;

type PayoutRow = Prisma.CommissionPayoutGetPayload<{ select: typeof PAYOUT_SELECT }>;

const toPayoutDto = (row: PayoutRow): PayoutDto => ({
  id: row.id,
  code: row.code,
  member_id: row.member_id,
  member_name: row.member.name,
  member_code: row.member.code,
  lines_total: num(row.lines_total),
  recovered: num(row.recovered),
  tax_pct: num(row.tax_pct),
  tax_withheld: num(row.tax_withheld),
  net: num(row.net),
  account_id: row.account_id,
  paid_on: day(row.paid_on),
  reference_no: row.reference_no,
  notes: row.notes,
  line_count: row._count.lines,
  created_at: row.created_at.toISOString(),
});

export async function listPayouts(
  filters: { member_id?: string } = {},
  paging: { page?: number; page_size?: number } = {},
): Promise<{ rows: PayoutDto[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 50));
  const where: Prisma.CommissionPayoutWhereInput = filters.member_id
    ? { member_id: filters.member_id }
    : {};

  const [rows, total] = await Promise.all([
    prisma.commissionPayout.findMany({
      where,
      select: PAYOUT_SELECT,
      orderBy: [{ paid_on: 'desc' }, { code: 'desc' }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.commissionPayout.count({ where }),
  ]);
  return { rows: (rows as PayoutRow[]).map(toPayoutDto), total, page, page_size };
}

/** The lines a payout paid, and the ones it took back. */
export async function payoutDetail(
  id: string,
): Promise<{ payout: PayoutDto; paid: CommissionLineDto[]; recovered: CommissionLineDto[] }> {
  const row = (await prisma.commissionPayout.findUnique({
    where: { id },
    select: PAYOUT_SELECT,
  })) as PayoutRow | null;
  if (!row) throw notFound('That payout');

  const rows = (await prisma.commissionLine.findMany({
    where: { OR: [{ payout_id: id }, { recovered_payout_id: id }] },
    select: LINE_SELECT,
    orderBy: [{ sale_date: 'desc' }, { stage_seq: 'asc' }],
  })) as LineRow[];
  const context = await lineContext(rows);
  const dtos = rows.map((line) => toLineDto(line, context));

  return {
    payout: toPayoutDto(row),
    paid: dtos.filter((line) => line.payout_id === id && line.recovered_payout_id !== id),
    recovered: dtos.filter((line) => line.recovered_payout_id === id),
  };
}

export interface PayoutInput {
  member_id: string;
  paid_on: string;
  tax_pct?: number;
  account_id?: string | null;
  reference_no?: string | null;
  notes?: string | null;
}

/**
 * Pays a member all their approved commission at once (plan §7.2 step 4).
 *
 * Paid commission on cancelled sales comes off first, then tax is withheld on
 * the rest. The payout is the record that money left, so it is written once and
 * never changed — the database refuses to update or delete one, and a mistake
 * is corrected by a further payout.
 */
export async function payCommission(input: PayoutInput): Promise<PayoutDto> {
  if (!input.paid_on) throw invalid('Enter the day it was paid.', { paid_on: 'When?' });
  const tax = Number(input.tax_pct ?? 0);
  if (!(tax >= 0 && tax <= 100)) {
    throw invalid('Tax withheld must be between 0 and 100%.', { tax_pct: 'Between 0 and 100.' });
  }

  const preview = await payoutPreview(input.member_id);
  if (preview.lines.length === 0) {
    throw conflict('This member has no approved commission to pay.');
  }

  const math = payoutMath(preview.lines_total, preview.recover_now, tax);

  const row = await withTx(async (tx: Tx) => {
    /*
     * The lines are re-read inside the transaction and matched against the
     * preview: between the preview and the save, somebody else may have
     * approved another line or paid this member, and paying a stale list would
     * either pay twice or quietly leave money behind.
     */
    const live = (await tx.commissionLine.findMany({
      where: { member_id: input.member_id, status: 'approved' },
      select: { id: true },
    })) as Array<{ id: string }>;
    const expected = new Set(preview.lines.map((line) => line.id));
    if (live.length !== expected.size || live.some((line) => !expected.has(line.id))) {
      throw conflict('This member’s commission changed while the payout was being prepared. Look at it again.');
    }

    const payout = await tx.commissionPayout.create({
      data: {
        code: await nextCode(tx, 'commission_payout', toDate(input.paid_on)),
        member_id: input.member_id,
        lines_total: math.lines_total,
        recovered: math.recovered,
        tax_pct: tax,
        tax_withheld: math.tax_withheld,
        net: math.net,
        account_id: input.account_id ?? null,
        paid_on: toDate(input.paid_on),
        reference_no: input.reference_no?.trim() || null,
        notes: input.notes?.trim() || null,
        created_by: currentActorId(),
      },
      select: { id: true },
    });

    await tx.commissionLine.updateMany({
      where: { id: { in: preview.lines.map((line) => line.id) } },
      data: { status: 'paid', payout_id: payout.id },
    });
    if (preview.recovering.length > 0) {
      await tx.commissionLine.updateMany({
        where: { id: { in: preview.recovering.map((line) => line.id) } },
        data: { status: 'recovered', recovered_payout_id: payout.id, to_recover: false },
      });
    }
    return payout;
  });

  const detail = await payoutDetail(row.id);
  return detail.payout;
}
