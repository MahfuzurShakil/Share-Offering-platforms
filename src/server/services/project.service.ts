import { Prisma } from '@prisma/client';
import { currentActorId } from '../audit/audit';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';
import { assertWithinScope, type Permitted, type StaffPrincipal } from '../auth/rbac';

/**
 * Projects — the first module to come off the interim Dexie layer.
 *
 * A project here is the thing shares are sold in: a master record, the money it
 * earns, and its papers (AGENTS.md). Land, towers and units belong to Phase 2.
 *
 * Everything a route handler would otherwise have done lives here: the fields
 * that may be written, the code the record is numbered with, the rules about
 * what may be deleted, and the shape the wire carries. The route parses, checks
 * the permission, and calls one of these.
 */

/* ------------------------------------------------------------------ *
 * What the wire carries
 * ------------------------------------------------------------------ */

/**
 * The columns the admin may read, named once.
 *
 * A `select` rather than the whole row: the public and investor services are
 * required to whitelist inside the select (AGENTS.md), and the admin's own read
 * doing the same keeps one habit instead of two — a column added to the model
 * reaches a screen only when somebody says so here.
 */
const ADMIN_SELECT = {
  id: true,
  code: true,
  name: true,
  project_type: true,
  status: true,
  sales_status: true,
  total_land_area: true,
  total_land_area_unit: true,
  description: true,
  location_summary: true,
  valuation: true,
  total_shares: true,
  valuation_date: true,
  expected_start_date: true,
  expected_completion_date: true,
  project_manager_id: true,
  architect: true,
  surroundings: true,
  amenities: true,
  cover_image_url: true,
  cover_image_document_id: true,
  construction_after_sale: true,
  default_late_fee_pct: true,
  default_late_fee_grace_days: true,
  is_public: true,
  is_featured: true,
  created_at: true,
  updated_at: true,
  manager: { select: { id: true, name: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof ADMIN_SELECT }>;

/** A project as a screen or a mobile app receives it. */
export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  project_type: string;
  status: string;
  sales_status: string;
  total_land_area: number | null;
  total_land_area_unit: string | null;
  description: string | null;
  location_summary: string | null;
  /** what 100% of the project is worth, and into how many shares it is cut */
  valuation: number | null;
  total_shares: number | null;
  valuation_date: string | null;
  /** 100 / total_shares — what one share of this project owns */
  share_pct: number | null;
  /** how many of its shares are promised to rounds already, and what is left */
  shares_offered: number;
  shares_free: number | null;
  /** false once a round has been on the market: the valuation is fixed then */
  valuation_locked: boolean;
  /** `YYYY-MM-DD`; these are dates, not moments */
  expected_start_date: string | null;
  expected_completion_date: string | null;
  project_manager_id: string | null;
  /** so a list does not have to fetch every user to show a name */
  project_manager_name: string | null;
  architect: string | null;
  surroundings: string | null;
  amenities: string[];
  cover_image_url: string | null;
  cover_image_document_id: string | null;
  construction_after_sale: string;
  default_late_fee_pct: number | null;
  default_late_fee_grace_days: number | null;
  is_public: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Decimal and Date do not survive JSON, so they are converted here — at the
 * boundary, once — rather than in each screen's formatter. Money and
 * percentages become `number`, a date column becomes `YYYY-MM-DD`, and a
 * timestamp becomes an ISO string.
 */
interface ValuationUse {
  /** shares the project's rounds have put on the market */
  offered: number;
  /** true once one of those rounds has been opened */
  locked: boolean;
}

function toDto(row: ProjectRow, use: ValuationUse = { offered: 0, locked: false }): ProjectDto {
  const shares = row.total_shares;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    project_type: row.project_type,
    status: row.status,
    sales_status: row.sales_status,
    total_land_area: decimalOrNull(row.total_land_area),
    total_land_area_unit: row.total_land_area_unit ?? null,
    description: row.description,
    location_summary: row.location_summary,
    valuation: decimalOrNull(row.valuation),
    total_shares: shares,
    valuation_date: dateOnly(row.valuation_date),
    share_pct: shares ? Number((100 / shares).toFixed(6)) : null,
    shares_offered: use.offered,
    shares_free: shares === null ? null : Math.max(0, shares - use.offered),
    valuation_locked: use.locked,
    expected_start_date: dateOnly(row.expected_start_date),
    expected_completion_date: dateOnly(row.expected_completion_date),
    project_manager_id: row.project_manager_id,
    project_manager_name: row.manager?.name ?? null,
    architect: row.architect,
    surroundings: row.surroundings,
    amenities: row.amenities,
    cover_image_url: row.cover_image_url,
    cover_image_document_id: row.cover_image_document_id,
    construction_after_sale: row.construction_after_sale,
    default_late_fee_pct: decimalOrNull(row.default_late_fee_pct),
    default_late_fee_grace_days: row.default_late_fee_grace_days,
    is_public: row.is_public,
    is_featured: row.is_featured,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function decimalOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * A `date` column is stored with no timezone, so it is built at UTC midnight.
 * Parsing `2026-04-01` as a local date would save 31 March in Dhaka.
 */
function fromDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(`${value}T00:00:00.000Z`);
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface ProjectFilters {
  search?: string;
  status?: string;
  project_type?: string;
  sales_status?: string;
  is_public?: boolean;
}

export type ProjectSort = 'newest' | 'oldest' | 'completion_soon' | 'name';

const ORDER: Record<ProjectSort, Prisma.ProjectOrderByWithRelationInput[]> = {
  newest: [{ created_at: 'desc' }],
  oldest: [{ created_at: 'asc' }],
  // a project with no target date is still planning, so it sorts last
  completion_soon: [{ expected_completion_date: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
  name: [{ name: 'asc' }],
};

function whereFor(principal: StaffPrincipal, filters: ProjectFilters): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {};

  /*
   * A user scoped to some projects sees only those. Filtering here rather than
   * after the query is the point: a scoped user must not be able to learn how
   * many projects exist from a count.
   */
  if (principal.project_ids.length > 0) where.id = { in: principal.project_ids };

  if (filters.status) where.status = filters.status as Prisma.ProjectWhereInput['status'];
  if (filters.project_type) {
    where.project_type = filters.project_type as Prisma.ProjectWhereInput['project_type'];
  }
  if (filters.sales_status) {
    where.sales_status = filters.sales_status as Prisma.ProjectWhereInput['sales_status'];
  }
  if (filters.is_public !== undefined) where.is_public = filters.is_public;

  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { location_summary: { contains: search, mode: 'insensitive' } },
      { architect: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

export interface ProjectPage {
  rows: ProjectDto[];
  total: number;
  page: number;
  page_size: number;
}

/** A page of projects, filtered, sorted and counted by Postgres. */
export async function listProjects(
  principal: StaffPrincipal,
  filters: ProjectFilters = {},
  paging: { page?: number; page_size?: number; sort?: ProjectSort } = {},
): Promise<ProjectPage> {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 50));
  const where = whereFor(principal, filters);

  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: ADMIN_SELECT,
      orderBy: ORDER[paging.sort ?? 'newest'],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.project.count({ where }),
  ]);

  /*
   * What each project's rounds have taken out of its shares, for the whole
   * page in one query — the share-offering form reads this to say how many
   * shares are still free before anything is typed.
   */
  const use = await valuationUseFor(rows.map((r: ProjectRow) => r.id));

  return {
    rows: rows.map((row: ProjectRow) => toDto(row, use.get(row.id))),
    total,
    page,
    page_size,
  };
}

/** One project, or 404. Scoped users are refused another team's project. */
export async function getProject(
  principal: StaffPrincipal,
  id: string,
): Promise<ProjectDto> {
  const row = await prisma.project.findUnique({ where: { id }, select: ADMIN_SELECT });
  if (!row) throw notFound('That project');
  assertWithinScope(principal, row.id);
  return toDto(row, await valuationUse(prisma, row.id));
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Everything a person may set on a project. Nothing else is written. */
export interface ProjectInput {
  name?: string;
  description?: string | null;
  /** the valuation block; refused once a round has been on the market */
  valuation?: number | null;
  total_shares?: number | null;
  valuation_date?: string | null;
  project_type?: string;
  status?: string;
  total_land_area?: number | null;
  total_land_area_unit?: string | null;
  location_summary?: string | null;
  expected_start_date?: string | null;
  expected_completion_date?: string | null;
  project_manager_id?: string | null;
  architect?: string | null;
  surroundings?: string | null;
  amenities?: string[];
  cover_image_url?: string | null;
  cover_image_document_id?: string | null;
  construction_after_sale?: string;
  default_late_fee_pct?: number | null;
  default_late_fee_grace_days?: number | null;
  is_public?: boolean;
  is_featured?: boolean;
}

/**
 * Two projects with one name are two answers to "which one?", so the name is
 * unique among the live projects — checked here rather than with a database
 * constraint, because a deleted project keeps its name and a unique index
 * would then block reusing it.
 */
async function assertNameFree(client: Tx, name: string, exceptId?: string): Promise<void> {
  const clash = await client.project.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { code: true },
  });
  if (clash) {
    throw invalid('Another project already has this name.', {
      name: `${clash.code} is already called that.`,
    });
  }
}

/** The manager has to be a real, live user — a stale id would show no name. */
async function assertManagerExists(client: Tx, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const user = await client.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw invalid('That project manager no longer exists.', { project_manager_id: 'Pick someone else.' });
}

function assertDatesInOrder(start: Date | null | undefined, end: Date | null | undefined): void {
  if (start && end && end < start) {
    throw invalid('The target sell-out cannot be before the sales start.', {
      expected_completion_date: 'This is before the sales start.',
    });
  }
}

/** Turns validated input into the columns to write. `undefined` means "leave". */
function columnsFor(input: ProjectInput): Prisma.ProjectUncheckedUpdateInput {
  const area = input.total_land_area;
  return {
    name: input.name?.trim(),
    description: input.description,
    valuation: input.valuation,
    total_shares: input.total_shares,
    valuation_date: fromDateOnly(input.valuation_date),
    project_type: input.project_type as Prisma.ProjectUncheckedUpdateInput['project_type'],
    status: input.status as Prisma.ProjectUncheckedUpdateInput['status'],
    total_land_area: area === undefined ? undefined : area,
    /* a unit with no area means nothing, and would print as "— katha" */
    total_land_area_unit:
      area === null
        ? null
        : (input.total_land_area_unit as Prisma.ProjectUncheckedUpdateInput['total_land_area_unit']),
    location_summary: input.location_summary,
    expected_start_date: fromDateOnly(input.expected_start_date),
    expected_completion_date: fromDateOnly(input.expected_completion_date),
    project_manager_id: input.project_manager_id,
    architect: input.architect,
    surroundings: input.surroundings,
    amenities: input.amenities,
    cover_image_url: input.cover_image_url,
    cover_image_document_id: input.cover_image_document_id,
    construction_after_sale:
      input.construction_after_sale as Prisma.ProjectUncheckedUpdateInput['construction_after_sale'],
    default_late_fee_pct: input.default_late_fee_pct,
    default_late_fee_grace_days: input.default_late_fee_grace_days,
    is_public: input.is_public,
    is_featured: input.is_featured,
  };
}

/* ------------------------------------------------------------------ *
 * The valuation block
 * ------------------------------------------------------------------ */

/**
 * How much of the project its rounds have taken, and whether the valuation is
 * still the owner's to change.
 *
 * A draft round is still private, so it holds nothing and locks nothing. Once
 * a round has been opened, people have been shown a price worked out from this
 * valuation — changing it afterwards would silently reprice what they were
 * promised, so it is fixed from then on. Cancelled rounds give their shares
 * back.
 */
async function valuationUse(client: Tx, projectId: string): Promise<ValuationUse> {
  const rounds = await client.shareOffering.findMany({
    where: { project_id: projectId, deleted_at: null, status: { not: 'cancelled' } },
    select: { status: true, total_shares: true },
  });

  let offered = 0;
  let locked = false;
  for (const round of rounds as { status: string; total_shares: number }[]) {
    offered += round.total_shares;
    if (round.status !== 'draft') locked = true;
  }
  return { offered, locked };
}

/** The same, for a page of projects at once. */
async function valuationUseFor(projectIds: string[]): Promise<Map<string, ValuationUse>> {
  const out = new Map<string, ValuationUse>();
  if (projectIds.length === 0) return out;

  const rounds = await prisma.shareOffering.findMany({
    where: { project_id: { in: projectIds }, deleted_at: null, status: { not: 'cancelled' } },
    select: { project_id: true, status: true, total_shares: true },
  });
  for (const round of rounds as { project_id: string; status: string; total_shares: number }[]) {
    const entry = out.get(round.project_id) ?? { offered: 0, locked: false };
    entry.offered += round.total_shares;
    if (round.status !== 'draft') entry.locked = true;
    out.set(round.project_id, entry);
  }
  return out;
}

/**
 * What a valuation has to satisfy to be usable.
 *
 * All three fields travel together: a value with no share count cannot price a
 * share, and a share count with no value cannot either.
 */
function checkValuation(input: ProjectInput, current: {
  valuation: Prisma.Decimal | null;
  total_shares: number | null;
  valuation_date: Date | null;
}): void {
  const touching =
    input.valuation !== undefined ||
    input.total_shares !== undefined ||
    input.valuation_date !== undefined;
  if (!touching) return;

  const valuation = input.valuation ?? decimalOrNull(current.valuation);
  const shares = input.total_shares ?? current.total_shares;
  const date = input.valuation_date ?? dateOnly(current.valuation_date);

  // clearing all three is how a valuation is removed before anything uses it
  if (valuation === null && shares === null) return;

  const fields: Record<string, string> = {};
  if (!(valuation !== null && valuation > 0)) {
    fields.valuation = 'What 100% of this project is worth.';
  }
  if (!(shares !== null && Number.isInteger(shares) && shares >= 1 && shares <= 10_000_000)) {
    fields.total_shares = 'How many equal shares the project is divided into.';
  }
  if (!date) fields.valuation_date = 'The day this valuation was made.';
  if (valuation !== null && shares !== null && shares > 0 && valuation / shares < 1) {
    fields.total_shares = 'That many shares would each be worth less than ৳1.';
  }
  if (Object.keys(fields).length > 0) {
    throw invalid('This valuation cannot be used to price a share.', fields);
  }
}

/**
 * Creates a project.
 *
 * The code and the record commit together — `nextCode` inside the transaction
 * is what makes `PRJ-2026-001` unrepeatable and gapless (see
 * `server/numbering/code-series.ts`). A new project is not selling: sales open
 * when somebody opens them.
 */
export async function createProject(input: ProjectInput): Promise<ProjectDto> {
  const name = input.name?.trim();
  if (!name) throw invalid('A project needs a name.', { name: 'Project name is required.' });

  const start = fromDateOnly(input.expected_start_date);
  const end = fromDateOnly(input.expected_completion_date);
  assertDatesInOrder(start, end);

  checkValuation(input, { valuation: null, total_shares: null, valuation_date: null });

  const row = await withTx(async (tx: Tx) => {
    await assertNameFree(tx, name);
    await assertManagerExists(tx, input.project_manager_id);
    const code = await nextCode(tx, 'project');
    return tx.project.create({
      data: {
        ...(columnsFor(input) as Prisma.ProjectUncheckedCreateInput),
        name,
        code,
        sales_status: 'not_open',
        created_by: currentActorId(),
      },
      select: ADMIN_SELECT,
    });
  });

  return toDto(row);
}

/** Changes a project. Only the fields that were sent are touched. */
export async function updateProject(
  principal: StaffPrincipal,
  id: string,
  input: ProjectInput,
): Promise<ProjectDto> {
  assertWithinScope(principal, id);

  const row = await withTx(async (tx: Tx) => {
    const current = await tx.project.findUnique({
      where: { id },
      select: {
        id: true,
        expected_start_date: true,
        expected_completion_date: true,
        is_public: true,
        valuation: true,
        total_shares: true,
        valuation_date: true,
      },
    });
    if (!current) throw notFound('That project');

    const use = await valuationUse(tx, id);
    const touchingValuation =
      input.valuation !== undefined ||
      input.total_shares !== undefined ||
      input.valuation_date !== undefined;

    if (touchingValuation && use.locked) {
      throw conflict(
        'This project has a share round on the market, so its valuation is fixed. A new valuation goes into a new round as a premium.',
      );
    }
    checkValuation(input, current);
    if (
      input.total_shares !== undefined &&
      input.total_shares !== null &&
      input.total_shares < use.offered
    ) {
      throw invalid(
        `Its draft rounds already offer ${use.offered} shares.`,
        { total_shares: `Cannot be fewer than ${use.offered}.` },
      );
    }

    const name = input.name?.trim();
    if (input.name !== undefined && !name) {
      throw invalid('A project needs a name.', { name: 'Project name is required.' });
    }
    if (name) await assertNameFree(tx, name, id);
    await assertManagerExists(tx, input.project_manager_id);

    const start = fromDateOnly(input.expected_start_date) ?? current.expected_start_date;
    const end = fromDateOnly(input.expected_completion_date) ?? current.expected_completion_date;
    assertDatesInOrder(start, end);

    const columns = columnsFor(input);
    /* unpublishing takes the project off the home page with it */
    if (input.is_public === false) columns.is_featured = false;
    if (input.is_featured === true && !(input.is_public ?? current.is_public)) {
      throw invalid('Publish the project before featuring it on the home page.', {
        is_featured: 'This project is not on the website yet.',
      });
    }

    const saved = await tx.project.update({ where: { id }, data: columns, select: ADMIN_SELECT });
    return { saved, use: await valuationUse(tx, id) };
  });

  return toDto(row.saved, row.use);
}

/** The moves sales can make, and from where. */
const SALES_MOVES: Record<string, string[]> = {
  not_open: ['open'],
  open: ['paused', 'sold_out'],
  paused: ['open', 'sold_out'],
  sold_out: ['open'],
};

/**
 * Opening, pausing and closing sales.
 *
 * Phase 1 has no construction or inventory to check a move against, so the
 * moves are the plain ones. What a share project is held to instead lives on
 * the offering, which arrives with the share-sale slice.
 */
export async function setSalesStatus(
  principal: StaffPrincipal,
  id: string,
  sales_status: string,
): Promise<ProjectDto> {
  assertWithinScope(principal, id);

  const current = await prisma.project.findUnique({
    where: { id },
    select: { sales_status: true },
  });
  if (!current) throw notFound('That project');

  if (current.sales_status === sales_status) {
    return getProject(principal, id);
  }
  if (!SALES_MOVES[current.sales_status]?.includes(sales_status)) {
    throw conflict(`Sales cannot go from ${current.sales_status} to ${sales_status}.`);
  }

  const row = await prisma.project.update({
    where: { id },
    data: {
      sales_status: sales_status as Prisma.ProjectUncheckedUpdateInput['sales_status'],
      /* a project that stops selling comes off the website's featured strip */
      ...(sales_status === 'not_open' ? { is_public: false, is_featured: false } : {}),
    },
    select: ADMIN_SELECT,
  });
  return toDto(row);
}

/**
 * Why this project cannot be deleted, or null.
 *
 * A project with money against it is closed, not deleted. Phase 1's money is
 * share sale and the revenue it earns; those tables arrive in S2 and S3, and
 * each one adds a clause here — which is why this is a function and not an
 * inline count.
 */
export async function deleteBlockReason(id: string): Promise<string | null> {
  void id;
  return null;
}

/**
 * Deletes a project, with what hangs off it.
 *
 * Soft delete: the row keeps its code and its audit trail and stops being
 * found. Staff scoping rows are hard-deleted instead — an assignment to a
 * project that no longer exists is not history, it is a dangling grant.
 */
export async function deleteProject(principal: Permitted, id: string): Promise<void> {
  assertWithinScope(principal, id);

  const blocked = await deleteBlockReason(id);
  if (blocked) throw conflict(blocked);

  await withTx(async (tx: Tx) => {
    const project = await tx.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) throw notFound('That project');

    await tx.userProjectAssignment.deleteMany({ where: { project_id: id } });
    await tx.document.updateMany({
      where: { entity_type: 'project', entity_id: id, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    await tx.project.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}
