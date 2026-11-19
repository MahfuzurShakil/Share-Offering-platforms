import { Prisma } from '@prisma/client';
import { SALE_HOLDS_SHARES, addDays, closesOn, daysBetween } from '@/lib/domain/share-sale';
import { currentActorId } from '../audit/audit';
import { assertWithinScope, type StaffPrincipal } from '../auth/rbac';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';

/**
 * Share offerings — a round of shares in one project
 * (PROJECT-SHARE-SALE-PLAN.md §4 step 2).
 *
 * The story this sits in: a project exists, the owner values it
 * (NAV + premium), puts a percentage of it on the market split into N shares
 * for a number of days, and a customer buys into that round. So every rule
 * here is about the round being a promise the owner can keep:
 *
 *   * what one share is comes from the project, not from the round. The
 *     project says what it is worth and into how many shares it is cut; a
 *     round offers some of those shares and may add a premium on top. So a
 *     share means the same fraction in every round, which is what makes a cap
 *     table across rounds readable at all;
 *   * the arithmetic is the platform's, not the typist's. The round copies the
 *     project's valuation and share size when it is drafted and keeps them,
 *     because what a buyer agreed to must not move when the project is
 *     revalued;
 *   * a project cannot be sold twice over — the shares its rounds hold, plus
 *     what its closed rounds actually sold, can never pass the project's own
 *     share count;
 *   * a draft can be changed, an open round cannot: its price is what buyers
 *     were shown.
 *
 * The maths lives in `lib/domain/share-sale.ts`, shared with the browser so
 * the form can show the same price before it saves (AGENTS.md).
 */

/* ------------------------------------------------------------------ *
 * What the wire carries
 * ------------------------------------------------------------------ */

const OFFERING_SELECT = {
  id: true,
  code: true,
  project_id: true,
  round_no: true,
  net_asset_value: true,
  premium_value: true,
  valuation: true,
  valuation_date: true,
  offered_pct: true,
  total_shares: true,
  share_pct: true,
  price_per_share: true,
  validity_days: true,
  opens_on: true,
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
  status: true,
  notes: true,
  created_at: true,
  updated_at: true,
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ShareOfferingSelect;

type OfferingRow = Prisma.ShareOfferingGetPayload<{ select: typeof OFFERING_SELECT }>;

export interface ShareOfferingDto {
  id: string;
  code: string;
  project_id: string;
  project_code: string;
  project_name: string;
  round_no: number;
  net_asset_value: number;
  premium_value: number;
  valuation: number;
  valuation_date: string;
  offered_pct: number;
  total_shares: number;
  share_pct: number;
  price_per_share: number;
  validity_days: number;
  opens_on: string | null;
  closes_on: string | null;
  min_shares: number;
  max_shares: number | null;
  min_down_payment_pct: number;
  max_installments: number;
  installment_frequency: string;
  late_fee_type: string;
  late_fee_pct: number;
  late_fee_amount: number | null;
  grace_days: number;
  hold_days: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** what this round has sold, holds and still has free */
  sold_shares: number;
  reserved_shares: number;
  available_shares: number;
  /** price_per_share × shares sold */
  raised: number;
}

const num = (value: Prisma.Decimal) => value.toNumber();
const numOrNull = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());
const day = (value: Date) => value.toISOString().slice(0, 10);
const dayOrNull = (value: Date | null) => (value === null ? null : day(value));
/** A `date` column is UTC midnight; parsing it as a local date would shift it. */
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Today in Dhaka, which is the day the office is working in. */
export function today(): string {
  return new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
}

interface Taken {
  sold: number;
  reserved: number;
}

function toDto(row: OfferingRow, taken: Taken = { sold: 0, reserved: 0 }): ShareOfferingDto {
  const price = num(row.price_per_share);
  return {
    id: row.id,
    code: row.code,
    project_id: row.project_id,
    project_code: row.project.code,
    project_name: row.project.name,
    round_no: row.round_no,
    net_asset_value: num(row.net_asset_value),
    premium_value: num(row.premium_value),
    valuation: num(row.valuation),
    valuation_date: day(row.valuation_date),
    offered_pct: num(row.offered_pct),
    total_shares: row.total_shares,
    share_pct: num(row.share_pct),
    price_per_share: price,
    validity_days: row.validity_days,
    opens_on: dayOrNull(row.opens_on),
    closes_on: dayOrNull(row.closes_on),
    min_shares: row.min_shares,
    max_shares: row.max_shares,
    min_down_payment_pct: num(row.min_down_payment_pct),
    max_installments: row.max_installments,
    installment_frequency: row.installment_frequency,
    late_fee_type: row.late_fee_type,
    late_fee_pct: num(row.late_fee_pct),
    late_fee_amount: numOrNull(row.late_fee_amount),
    grace_days: row.grace_days,
    hold_days: row.hold_days,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    sold_shares: taken.sold,
    reserved_shares: taken.reserved,
    available_shares: Math.max(0, row.total_shares - taken.sold - taken.reserved),
    raised: taken.sold * price,
  };
}

/**
 * How many shares each of these rounds has sold and is holding.
 *
 * One grouped query for the whole page rather than a count per row: the list
 * shows "320 of 500 sold" on every card, and the browser must not be the thing
 * that adds those up.
 */
async function takenByOffering(
  client: Tx,
  offeringIds: string[],
): Promise<Map<string, Taken>> {
  const out = new Map<string, Taken>();
  if (offeringIds.length === 0) return out;

  const rows = await client.shareSale.groupBy({
    by: ['offering_id', 'status'],
    where: { offering_id: { in: offeringIds }, deleted_at: null },
    _sum: { shares: true },
  });

  for (const row of rows as { offering_id: string; status: string; _sum: { shares: number | null } }[]) {
    if (!SALE_HOLDS_SHARES[row.status as keyof typeof SALE_HOLDS_SHARES]) continue;
    const entry = out.get(row.offering_id) ?? { sold: 0, reserved: 0 };
    if (row.status === 'reserved') entry.reserved += row._sum.shares ?? 0;
    else entry.sold += row._sum.shares ?? 0;
    out.set(row.offering_id, entry);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * How much of the project is still free
 * ------------------------------------------------------------------ */

/**
 * Shares of the project its rounds are holding.
 *
 * A live round holds every share it offered, because any of them may still
 * sell. A closed one holds only what it actually sold or still has reserved —
 * the rest went back to the owner and can go into a later round. A cancelled
 * one holds nothing.
 */
async function sharesTaken(client: Tx, projectId: string, exceptId?: string): Promise<number> {
  const offerings = await client.shareOffering.findMany({
    where: { project_id: projectId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, status: true, total_shares: true },
  });
  const taken = await takenByOffering(client, offerings.map((o: { id: string }) => o.id));

  let total = 0;
  for (const offering of offerings as { id: string; status: string; total_shares: number }[]) {
    if (offering.status === 'cancelled') continue;
    if (offering.status === 'closed') {
      const held = taken.get(offering.id) ?? { sold: 0, reserved: 0 };
      total += held.sold + held.reserved;
      continue;
    }
    total += offering.total_shares;
  }
  return total;
}

export interface ProjectRoom {
  /** the project's own share count, or null when it has no valuation yet */
  total_shares: number | null;
  taken: number;
  free: number;
  /** the same as a percentage, for a screen that talks in percentages */
  free_pct: number;
}

/** What is still free to offer on this project. */
export async function roomOn(projectId: string, exceptId?: string): Promise<ProjectRoom> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { total_shares: true },
  });
  const total = project?.total_shares ?? null;
  const taken = await sharesTaken(prisma, projectId, exceptId);
  const free = total === null ? 0 : Math.max(0, total - taken);
  return {
    total_shares: total,
    taken,
    free,
    free_pct: total ? Number(((free / total) * 100).toFixed(6)) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Validation — the round as a promise the owner can keep
 * ------------------------------------------------------------------ */

export interface OfferingInput {
  project_id: string;
  /** what the owner adds on top of the project's valuation for this round */
  premium_value: number;
  /** how many of the project's shares this round puts on the market */
  total_shares: number;
  /** how long it stays open once opened; worked out when a close date is given */
  validity_days?: number;
  closes_on?: string | null;
  min_shares: number;
  max_shares: number;
  min_down_payment_pct: number;
  max_installments: number;
  installment_frequency: 'monthly' | 'quarterly';
  late_fee_type: 'pct_once' | 'fixed_once';
  late_fee_pct: number;
  late_fee_amount?: number | null;
  grace_days: number;
  hold_days: number;
  notes?: string | null;
}

/** The round's terms, with what the project contributes already filled in. */
type Normalised = OfferingInput & {
  validity_days: number;
  /** copied from the project */
  net_asset_value: number;
  valuation_date: string;
  share_pct: number;
  offered_pct: number;
};

/** The valuation block a round is priced from. */
export interface ProjectValuation {
  valuation: number;
  total_shares: number;
  valuation_date: string;
  share_pct: number;
}

/**
 * A planned close date becomes the number of days it stands for, counted from
 * today — a draft opened weeks later keeps the date it was given, and its days
 * are counted again then (SHARE-SALE-FEEDBACK-PLAN.md A2).
 */
function normalise(input: OfferingInput, project: ProjectValuation): Normalised {
  const fee = input.late_fee_type;
  const fromProject = {
    net_asset_value: project.valuation,
    valuation_date: project.valuation_date,
    share_pct: project.share_pct,
    offered_pct: Number((input.total_shares * project.share_pct).toFixed(6)),
  };
  const base: OfferingInput & typeof fromProject = {
    ...fromProject,
    ...input,
    // only the chosen fee type's number is kept, so the other can never read
    // as a second fee on the same installment
    late_fee_pct: fee === 'pct_once' ? input.late_fee_pct : 0,
    late_fee_amount: fee === 'fixed_once' ? (input.late_fee_amount ?? 0) : null,
    notes: input.notes?.trim() || null,
  };

  if (base.closes_on) {
    if (base.closes_on <= today()) {
      throw invalid('The offer has to close after today.', {
        closes_on: 'Pick a date later than today.',
      });
    }
    return { ...base, validity_days: daysBetween(today(), base.closes_on) + 1 };
  }
  return { ...base, closes_on: null, validity_days: Number(base.validity_days) };
}

const whole = (n: number) => Number.isInteger(Number(n));

/** Everything that must be true of a round, with the field each belongs to. */
function check(i: Normalised): void {
  const fields: Record<string, string> = {};
  const fail = (field: string, message: string) => {
    fields[field] ??= message;
  };

  if (!(i.premium_value >= 0)) fail('premium_value', 'The premium cannot be negative.');
  if (!(whole(i.total_shares) && i.total_shares >= 1)) {
    fail('total_shares', 'How many of the project’s shares this round offers.');
  }
  if (!(whole(i.validity_days) && i.validity_days >= 1 && i.validity_days <= 365)) {
    fail('validity_days', 'The offer has to close within a year — 1 to 365 days.');
  }
  if (!(whole(i.min_shares) && i.min_shares >= 1)) {
    fail('min_shares', 'At least 1 share per customer.');
  }
  if (!(whole(i.max_shares) && i.max_shares >= i.min_shares)) {
    fail('max_shares', 'The maximum cannot be below the minimum.');
  }
  if (i.max_shares > i.total_shares) {
    fail('max_shares', 'One customer cannot take more than the round holds.');
  }
  if (!(i.min_down_payment_pct >= 0 && i.min_down_payment_pct <= 100)) {
    fail('min_down_payment_pct', 'Between 0 and 100%.');
  }
  if (!(whole(i.max_installments) && i.max_installments >= 0 && i.max_installments <= 120)) {
    fail('max_installments', 'A whole number of installments, 0 to 120.');
  }
  if (i.late_fee_type === 'fixed_once') {
    if (!(whole(i.late_fee_amount ?? 0) && Number(i.late_fee_amount) >= 0)) {
      fail('late_fee_amount', 'Whole taka, 0 or more.');
    }
  } else if (!(i.late_fee_pct >= 0 && i.late_fee_pct <= 25)) {
    fail('late_fee_pct', 'Between 0 and 25% of the overdue installment.');
  }
  if (!(whole(i.grace_days) && i.grace_days >= 0)) {
    fail('grace_days', 'Grace days cannot be negative.');
  }
  if (!(whole(i.hold_days) && i.hold_days >= 1 && i.hold_days <= 60)) {
    fail('hold_days', 'Reserved shares are held for 1 to 60 days.');
  }
  if (priceOf(i) < 1) {
    fail('premium_value', 'A share of this project works out below ৳1.');
  }

  if (Object.keys(fields).length > 0) {
    throw invalid('Some of this round’s terms are not usable.', fields);
  }
}

/**
 * What one share costs in this round: the project's valuation plus this
 * round's premium, times the fraction one share owns.
 *
 * `offeringMath` in `lib/domain/share-sale.ts` is the same sum written for the
 * form, which splits a percentage into shares. Here the share size comes from
 * the project instead, so the price is taken straight from it.
 */
function priceOf(i: { net_asset_value: number; premium_value: number; share_pct: number }): number {
  return Math.round(((i.net_asset_value + i.premium_value) * i.share_pct) / 100);
}

/** The project's valuation block, or the reason a round cannot be priced. */
async function valuationOf(client: Tx, projectId: string): Promise<ProjectValuation> {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      sales_status: true,
      valuation: true,
      total_shares: true,
      valuation_date: true,
    },
  });
  if (!project) throw invalid('That project no longer exists.', { project_id: 'Pick a project.' });
  if (project.sales_status === 'not_open') {
    throw conflict(
      `${project.name} is not selling yet. Open its sales before offering a round of shares.`,
    );
  }
  if (!project.valuation || !project.total_shares || !project.valuation_date) {
    throw conflict(
      `${project.name} has no valuation yet. Set what it is worth and how many shares it is divided into on its Valuation tab first.`,
    );
  }
  return {
    valuation: num(project.valuation),
    total_shares: project.total_shares,
    valuation_date: day(project.valuation_date),
    share_pct: Number((100 / project.total_shares).toFixed(6)),
  };
}

async function assertRoomFor(
  client: Tx,
  projectId: string,
  shares: number,
  projectShares: number,
  exceptId?: string,
): Promise<void> {
  const free = Math.max(0, projectShares - (await sharesTaken(client, projectId, exceptId)));
  if (shares > free) {
    throw invalid(
      `Only ${free} of this project’s ${projectShares} shares are still free — the rest are in its other rounds.`,
      { total_shares: `At most ${free} are left.` },
    );
  }
}

/** The columns a round is written with, from its terms and the maths. */
function columnsFor(i: Normalised) {
  return {
    net_asset_value: new Prisma.Decimal(i.net_asset_value),
    premium_value: new Prisma.Decimal(i.premium_value),
    valuation: new Prisma.Decimal(i.net_asset_value + i.premium_value),
    valuation_date: toDate(i.valuation_date),
    offered_pct: new Prisma.Decimal(i.offered_pct.toFixed(6)),
    total_shares: i.total_shares,
    share_pct: new Prisma.Decimal(i.share_pct.toFixed(6)),
    price_per_share: new Prisma.Decimal(priceOf(i)),
    validity_days: i.validity_days,
    closes_on: i.closes_on ? toDate(i.closes_on) : null,
    min_shares: i.min_shares,
    max_shares: i.max_shares,
    min_down_payment_pct: new Prisma.Decimal(i.min_down_payment_pct),
    max_installments: i.max_installments,
    installment_frequency: i.installment_frequency,
    late_fee_type: i.late_fee_type,
    late_fee_pct: new Prisma.Decimal(i.late_fee_pct),
    late_fee_amount: i.late_fee_amount === null || i.late_fee_amount === undefined
      ? null
      : new Prisma.Decimal(i.late_fee_amount),
    grace_days: i.grace_days,
    hold_days: i.hold_days,
    notes: i.notes ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface OfferingFilters {
  project_id?: string;
  status?: string;
  search?: string;
}

export interface OfferingPage {
  rows: ShareOfferingDto[];
  total: number;
  page: number;
  page_size: number;
}

export async function listOfferings(
  principal: StaffPrincipal,
  filters: OfferingFilters = {},
  paging: { page?: number; page_size?: number } = {},
): Promise<OfferingPage> {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 50));

  const where: Prisma.ShareOfferingWhereInput = {};
  if (principal.project_ids.length > 0) where.project_id = { in: principal.project_ids };
  if (filters.project_id) {
    assertWithinScope(principal, filters.project_id);
    where.project_id = filters.project_id;
  }
  if (filters.status) {
    where.status = filters.status as Prisma.ShareOfferingWhereInput['status'];
  }
  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { project: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.shareOffering.findMany({
      where,
      select: OFFERING_SELECT,
      orderBy: [{ created_at: 'desc' }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.shareOffering.count({ where }),
  ]);

  const taken = await takenByOffering(prisma, rows.map((r: OfferingRow) => r.id));
  return {
    rows: rows.map((row: OfferingRow) => toDto(row, taken.get(row.id))),
    total,
    page,
    page_size,
  };
}

export async function getOffering(
  principal: StaffPrincipal,
  id: string,
): Promise<ShareOfferingDto> {
  const row = await prisma.shareOffering.findUnique({ where: { id }, select: OFFERING_SELECT });
  if (!row) throw notFound('That share offering');
  assertWithinScope(principal, row.project_id);
  const taken = await takenByOffering(prisma, [row.id]);
  return toDto(row, taken.get(row.id));
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * Opens a new draft round.
 *
 * `round_no` is read and written inside the transaction, like the code — two
 * people drafting a round on one project at the same moment must not both
 * become round 2, and the unique index on (project_id, round_no) is what makes
 * that a failure rather than a surprise.
 */
export async function createOffering(
  principal: StaffPrincipal,
  input: OfferingInput,
): Promise<ShareOfferingDto> {
  assertWithinScope(principal, input.project_id);

  const row = await withTx(async (tx: Tx) => {
    const valuation = await valuationOf(tx, input.project_id);
    const i = normalise(input, valuation);
    check(i);
    await assertRoomFor(tx, i.project_id, i.total_shares, valuation.total_shares);

    const last = await tx.shareOffering.findFirst({
      where: { project_id: i.project_id },
      select: { round_no: true },
      orderBy: { round_no: 'desc' },
    });

    return tx.shareOffering.create({
      data: {
        ...columnsFor(i),
        code: await nextCode(tx, 'share_offering'),
        project_id: i.project_id,
        round_no: (last?.round_no ?? 0) + 1,
        status: 'draft',
        opens_on: null,
        created_by: currentActorId(),
      },
      select: OFFERING_SELECT,
    });
  });

  return toDto(row);
}

/**
 * Changes a draft. Only a draft: an open round's price and terms are what
 * buyers were shown, so a change to those is a new round, not an edit.
 */
export async function updateOffering(
  principal: StaffPrincipal,
  id: string,
  input: OfferingInput,
): Promise<ShareOfferingDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.shareOffering.findUnique({
      where: { id },
      select: { id: true, status: true, project_id: true },
    });
    if (!current) throw notFound('That share offering');
    assertWithinScope(principal, current.project_id);
    if (current.status !== 'draft') {
      throw conflict(
        'Only a draft can be changed. Close this round and open a new one instead.',
      );
    }
    if (current.project_id !== input.project_id) {
      throw conflict('A round cannot be moved to another project.');
    }

    const valuation = await valuationOf(tx, input.project_id);
    const i = normalise(input, valuation);
    check(i);
    await assertRoomFor(tx, i.project_id, i.total_shares, valuation.total_shares, id);

    return tx.shareOffering.update({
      where: { id },
      data: columnsFor(i),
      select: OFFERING_SELECT,
    });
  });

  return toDto(row);
}

/**
 * Puts a draft on the market.
 *
 * The close date is the one planned on the draft if it is still in the future,
 * otherwise the validity days counted from the opening day — so a draft
 * prepared in October and opened in December runs its full window.
 */
export async function openOffering(
  principal: StaffPrincipal,
  id: string,
  opens_on: string = today(),
  closes?: string,
): Promise<ShareOfferingDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.shareOffering.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        project_id: true,
        total_shares: true,
        premium_value: true,
        closes_on: true,
        validity_days: true,
      },
    });
    if (!current) throw notFound('That share offering');
    assertWithinScope(principal, current.project_id);
    if (current.status !== 'draft') throw conflict('Only a draft can be opened.');

    const valuation = await valuationOf(tx, current.project_id);
    await assertRoomFor(tx, current.project_id, current.total_shares, valuation.total_shares, id);

    /*
     * The project's valuation is copied again here, not only when the draft
     * was written: this is the moment the round becomes a promise, so it is
     * the moment the price is fixed. A draft prepared before a revaluation
     * would otherwise go to the market at a price the project no longer
     * stands behind — and from now on the project's valuation is locked, so
     * this copy and the project agree for good.
     */
    const priced = {
      net_asset_value: new Prisma.Decimal(valuation.valuation),
      valuation: new Prisma.Decimal(valuation.valuation + num(current.premium_value)),
      valuation_date: toDate(valuation.valuation_date),
      share_pct: new Prisma.Decimal(valuation.share_pct.toFixed(6)),
      offered_pct: new Prisma.Decimal((current.total_shares * valuation.share_pct).toFixed(6)),
      price_per_share: new Prisma.Decimal(
        priceOf({
          net_asset_value: valuation.valuation,
          premium_value: num(current.premium_value),
          share_pct: valuation.share_pct,
        }),
      ),
    };

    const planned = dayOrNull(current.closes_on);
    const closesDay =
      closes ??
      (planned && planned >= opens_on ? planned : closesOn(opens_on, current.validity_days));
    if (closesDay < opens_on) {
      throw invalid('The offer cannot close before it opens.', {
        closes_on: 'This is before the opening day.',
      });
    }
    const days = daysBetween(opens_on, closesDay) + 1;
    if (days > 365) {
      throw invalid('The offer has to close within a year of opening.', {
        closes_on: 'That is more than a year away.',
      });
    }

    return tx.shareOffering.update({
      where: { id },
      data: {
        ...priced,
        status: 'open',
        opens_on: toDate(opens_on),
        closes_on: toDate(closesDay),
        validity_days: days,
      },
      select: OFFERING_SELECT,
    });
  });

  const taken = await takenByOffering(prisma, [row.id]);
  return toDto(row, taken.get(row.id));
}

/** Lets an open round run longer — the owner's call when it ends with shares left. */
export async function extendOffering(
  principal: StaffPrincipal,
  id: string,
  extra_days: number,
): Promise<ShareOfferingDto> {
  if (!(whole(extra_days) && extra_days >= 1 && extra_days <= 365)) {
    throw invalid('Extend by 1 to 365 days.', { extra_days: 'Between 1 and 365.' });
  }

  const current = await prisma.shareOffering.findUnique({
    where: { id },
    select: { id: true, status: true, project_id: true, closes_on: true, validity_days: true },
  });
  if (!current) throw notFound('That share offering');
  assertWithinScope(principal, current.project_id);
  if (current.status !== 'open' || !current.closes_on) {
    throw conflict('Only an open round can be extended.');
  }

  /*
   * A round whose window has already ended is extended from today, not from
   * the day it lapsed — otherwise "extend by 7 days" on a round that ended a
   * month ago would still leave it closed.
   */
  const from = dayOrNull(current.closes_on)!;
  const base = from < today() ? today() : from;
  const closesDay = addDays(base, extra_days);

  const row = await prisma.shareOffering.update({
    where: { id },
    data: {
      closes_on: toDate(closesDay),
      validity_days: current.validity_days + daysBetween(from, closesDay),
    },
    select: OFFERING_SELECT,
  });
  const taken = await takenByOffering(prisma, [row.id]);
  return toDto(row, taken.get(row.id));
}

/** Stops selling. Shares already reserved stay reserved until signed or released. */
export async function closeOffering(
  principal: StaffPrincipal,
  id: string,
): Promise<ShareOfferingDto> {
  const current = await prisma.shareOffering.findUnique({
    where: { id },
    select: { id: true, status: true, project_id: true },
  });
  if (!current) throw notFound('That share offering');
  assertWithinScope(principal, current.project_id);
  if (current.status !== 'open') throw conflict('Only an open round can be closed.');

  const row = await prisma.shareOffering.update({
    where: { id },
    data: { status: 'closed' },
    select: OFFERING_SELECT,
  });
  const taken = await takenByOffering(prisma, [row.id]);
  return toDto(row, taken.get(row.id));
}

/** Withdraws a round nobody has bought into. */
export async function cancelOffering(
  principal: StaffPrincipal,
  id: string,
): Promise<ShareOfferingDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.shareOffering.findUnique({
      where: { id },
      select: { id: true, status: true, project_id: true },
    });
    if (!current) throw notFound('That share offering');
    assertWithinScope(principal, current.project_id);
    if (current.status === 'cancelled' || current.status === 'closed') {
      throw conflict('This round cannot be cancelled.');
    }

    const held = await tx.shareSale.count({
      where: {
        offering_id: id,
        deleted_at: null,
        status: { in: ['reserved', 'agreement_signed', 'fully_paid'] },
      },
    });
    if (held > 0) {
      throw conflict(
        `${held} customer purchase${held === 1 ? ' holds' : 's hold'} shares in this round. Close it instead.`,
      );
    }

    return tx.shareOffering.update({
      where: { id },
      data: { status: 'cancelled' },
      select: OFFERING_SELECT,
    });
  });
  return toDto(row);
}

/** Deletes a draft. Anything that has been on the market is closed, not deleted. */
export async function deleteOffering(principal: StaffPrincipal, id: string): Promise<void> {
  const current = await prisma.shareOffering.findUnique({
    where: { id },
    select: { id: true, status: true, project_id: true },
  });
  if (!current) throw notFound('That share offering');
  assertWithinScope(principal, current.project_id);
  if (current.status !== 'draft') {
    throw conflict('Only a draft can be deleted. Close the round instead.');
  }
  await prisma.shareOffering.delete({ where: { id } });
}
