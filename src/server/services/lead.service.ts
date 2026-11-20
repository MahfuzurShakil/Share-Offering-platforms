import { Prisma } from '@prisma/client';
import { isMobile, normalizePhone } from '@/lib/domain/phone';
import { currentActorId } from '../audit/audit';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';

/**
 * Leads — where the story starts (SALES-FLOW-PLAN.md, Scope v3 §4).
 *
 * An inquiry arrives from the website, WhatsApp, a walk-in or a phone call;
 * somebody works it through the pipeline; it ends either as an investor or as
 * a reason it did not. Two rules carry most of the weight:
 *
 *   * **The phone number is the dedup key.** A repeat caller joins their own
 *     lead as another activity rather than becoming a second row, so one
 *     person's conversation stays in one place. `customers` works the same
 *     way, which is what makes the hand-over from lead to investor possible.
 *   * **Nothing moves silently.** A status change, a completed stage and an
 *     assignment all leave an entry in the follow-up log, so the next person
 *     to open the lead can see why it is where it is.
 *
 * The one piece of state that is *not* stored is the open follow-up date: it
 * is the newest activity's, because a later entry supersedes an earlier one.
 * Storing it as well would give two answers to one question.
 */

/* ------------------------------------------------------------------ *
 * What the wire carries
 * ------------------------------------------------------------------ */

const LEAD_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  email: true,
  source: true,
  status: true,
  inquiry_message: true,
  interested_project_id: true,
  budget_range: true,
  assigned_to: true,
  lost_reason: true,
  page_url: true,
  utm_source: true,
  utm_medium: true,
  utm_campaign: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_SELECT }>;

const ACTIVITY_SELECT = {
  id: true,
  lead_id: true,
  activity_type: true,
  notes: true,
  activity_date: true,
  next_follow_up_date: true,
  details: true,
  created_at: true,
} satisfies Prisma.LeadActivitySelect;

type ActivityRow = Prisma.LeadActivityGetPayload<{ select: typeof ACTIVITY_SELECT }>;

export type LeadStatus = LeadRow['status'];
export type LeadSource = LeadRow['source'];
export type LeadActivityType = ActivityRow['activity_type'];

export interface LeadActivityDto {
  id: string;
  lead_id: string;
  activity_type: LeadActivityType;
  notes: string;
  activity_date: string;
  next_follow_up_date: string | null;
  details: Record<string, string> | null;
  created_at: string;
}

export interface LeadDto {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  status: LeadStatus;
  inquiry_message: string | null;
  interested_project_id: string | null;
  budget_range: string | null;
  assigned_to: string | null;
  lost_reason: string | null;
  page_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_at: string;
  updated_at: string;

  /**
   * Counted by the database rather than by the browser — the list shows all
   * three on every line, which is what the move to Postgres is for.
   */
  activity_count: number;
  /** when anybody last touched it, whatever the activity was */
  last_activity_at: string | null;
  /** the open follow-up date, or null once the lead is booked or lost */
  next_follow_up: string | null;
  /** names, so a row needs no second request to be readable */
  assignee_name: string | null;
  project_name: string | null;
  project_code: string | null;
}

/** The lead, its whole log, and what became of it. */
export interface LeadDetailDto extends LeadDto {
  activities: LeadActivityDto[];
  assignee: { id: string; name: string; phone: string } | null;
  project: { id: string; code: string; name: string; location_summary: string | null } | null;
  /** the investor made from this lead, if one was */
  customer: { id: string; code: string; name: string } | null;
  /** what that investor bought — a booked lead always has at least one */
  purchases: Array<{ id: string; code: string; status: string; shares: number }>;
}

const CLOSED: LeadStatus[] = ['booked', 'lost'];

const day = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));

const toDay = (value: string | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(`${value}T00:00:00.000Z`);
};

/** `details` is free-form JSON in the column; only label → text reaches a screen. */
function toDetails(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && entry !== undefined) out[key] = String(entry);
  }
  return Object.keys(out).length ? out : null;
}

function toActivityDto(row: ActivityRow): LeadActivityDto {
  return {
    id: row.id,
    lead_id: row.lead_id,
    activity_type: row.activity_type,
    notes: row.notes,
    activity_date: row.activity_date.toISOString(),
    next_follow_up_date: day(row.next_follow_up_date),
    details: toDetails(row.details),
    created_at: row.created_at.toISOString(),
  };
}

/** What a list row needs beyond the lead's own columns. */
interface Derived {
  activity_count: number;
  last_activity_at: string | null;
  next_follow_up: string | null;
  assignee_name: string | null;
  project_name: string | null;
  project_code: string | null;
}

const NOTHING: Derived = {
  activity_count: 0,
  last_activity_at: null,
  next_follow_up: null,
  assignee_name: null,
  project_name: null,
  project_code: null,
};

function toDto(row: LeadRow, derived: Derived = NOTHING): LeadDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    email: row.email,
    source: row.source,
    status: row.status,
    inquiry_message: row.inquiry_message,
    interested_project_id: row.interested_project_id,
    budget_range: row.budget_range,
    assigned_to: row.assigned_to,
    lost_reason: row.lost_reason,
    page_url: row.page_url,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    ...derived,
  };
}

/* ------------------------------------------------------------------ *
 * The follow-up, worked out rather than stored
 * ------------------------------------------------------------------ */

/**
 * Each open lead's follow-up date: the newest activity's, since a later entry
 * supersedes an earlier one. Booked and lost leads are left out — nobody
 * follows up a closed lead.
 *
 * `DISTINCT ON` is the whole query: Postgres picks the latest row per lead
 * without reading the rest, where the prototype pulled every activity into the
 * browser and sorted them there.
 */
async function followUpDue(client: Tx): Promise<Map<string, string>> {
  const rows = await client.$queryRaw<Array<{ lead_id: string; due: Date | null }>>`
    SELECT DISTINCT ON (a.lead_id) a.lead_id, a.next_follow_up_date AS due
    FROM lead_activities a
    JOIN leads l ON l.id = a.lead_id
    WHERE l.deleted_at IS NULL
      AND l.status NOT IN ('booked', 'lost')
    ORDER BY a.lead_id, a.activity_date DESC, a.created_at DESC
  `;
  const map = new Map<string, string>();
  for (const row of rows) {
    const date = day(row.due);
    if (date) map.set(row.lead_id, date);
  }
  return map;
}

/** Purchases that still stand. A released or cancelled one holds nothing. */
const LIVE_SALE = ['reserved', 'agreement_signed', 'fully_paid'] as const;

/**
 * Leads whose investor already holds a live purchase.
 *
 * A lead only flips to `booked` when the purchase is confirmed, so one sitting
 * at `agreement_signed` kept its old status and stayed on the call queue — the
 * desk was being told to chase somebody who had already paid.
 */
async function alreadyBought(client: Tx): Promise<Set<string>> {
  const rows = await client.customer.findMany({
    where: {
      lead_id: { not: null },
      sales: { some: { deleted_at: null, status: { in: LIVE_SALE } } },
    },
    select: { lead_id: true },
  });
  return new Set(rows.map((row: { lead_id: string | null }) => row.lead_id as string));
}

/** Everything a page of rows needs that is not on the leads table. */
async function derivedFor(client: Tx, ids: string[]): Promise<Map<string, Derived>> {
  const out = new Map<string, Derived>();
  if (ids.length === 0) return out;

  const [activities, due, leads] = await Promise.all([
    client.leadActivity.groupBy({
      by: ['lead_id'],
      where: { lead_id: { in: ids } },
      _count: { _all: true },
      _max: { activity_date: true },
    }),
    followUpDue(client),
    client.lead.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        assignee: { select: { name: true } },
        project: { select: { code: true, name: true } },
      },
    }),
  ]);

  const counted = new Map(
    (
      activities as Array<{
        lead_id: string;
        _count: { _all: number };
        _max: { activity_date: Date | null };
      }>
    ).map((row) => [row.lead_id, row]),
  );

  for (const lead of leads as Array<{
    id: string;
    status: LeadStatus;
    assignee: { name: string } | null;
    project: { code: string; name: string } | null;
  }>) {
    const activity = counted.get(lead.id);
    out.set(lead.id, {
      activity_count: activity?._count._all ?? 0,
      last_activity_at: activity?._max.activity_date?.toISOString() ?? null,
      next_follow_up: CLOSED.includes(lead.status) ? null : (due.get(lead.id) ?? null),
      assignee_name: lead.assignee?.name ?? null,
      project_name: lead.project?.name ?? null,
      project_code: lead.project?.code ?? null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface LeadFilters {
  /** name, code, email or phone — the one box the desk types into */
  search?: string;
  status?: LeadStatus | 'all';
  source?: LeadSource | 'all';
  assigned_to?: string | 'all' | 'unassigned';
  interested_project_id?: string;
  /** narrows to the daily task list */
  follow_up?: 'overdue' | 'today' | 'all';
}

export type LeadSort = 'newest' | 'oldest' | 'name' | 'follow_up';

export interface LeadPage {
  rows: LeadDto[];
  total: number;
  page: number;
  page_size: number;
}

function whereFor(filters: LeadFilters): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};

  if (filters.status && filters.status !== 'all') where.status = filters.status;
  if (filters.source && filters.source !== 'all') where.source = filters.source;
  if (filters.assigned_to === 'unassigned') where.assigned_to = null;
  else if (filters.assigned_to && filters.assigned_to !== 'all') {
    where.assigned_to = filters.assigned_to;
  }
  if (filters.interested_project_id) {
    where.interested_project_id = filters.interested_project_id;
  }

  const search = filters.search?.trim();
  if (search) {
    const digits = normalizePhone(search);
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { budget_range: { contains: search, mode: 'insensitive' } },
      // a number typed with spaces still has to find the lead it belongs to
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ];
  }
  return where;
}

export async function listLeads(
  filters: LeadFilters = {},
  paging: { page?: number; page_size?: number; sort?: LeadSort } = {},
  today = new Date().toISOString().slice(0, 10),
): Promise<LeadPage> {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 50));
  const where = whereFor(filters);

  /*
   * "Overdue" and "due today" are about the newest activity per lead, which no
   * column holds — so the dates are worked out first and become an id filter.
   * The set is small by definition: it is the work outstanding today.
   */
  if (filters.follow_up && filters.follow_up !== 'all') {
    const due = await followUpDue(prisma);
    const ids = [...due.entries()]
      .filter(([, date]) => (filters.follow_up === 'overdue' ? date < today : date === today))
      .map(([id]) => id);
    where.id = { in: ids };
  }

  /*
   * Sorting by follow-up is the same problem, and cannot be done in `ORDER BY`
   * on the leads table either. The ids are fetched (ids only, so it stays
   * cheap), ordered by their due date, and only the page asked for is read in
   * full. Leads without a date sort last, as "no follow-up pending" should.
   */
  if (paging.sort === 'follow_up') {
    const [matching, due] = await Promise.all([
      prisma.lead.findMany({ where, select: { id: true, created_at: true } }),
      followUpDue(prisma),
    ]);
    const ordered = (matching as Array<{ id: string; created_at: Date }>)
      .sort((a, b) => {
        const left = due.get(a.id) ?? '9999-12-31';
        const right = due.get(b.id) ?? '9999-12-31';
        return left === right
          ? b.created_at.getTime() - a.created_at.getTime()
          : left.localeCompare(right);
      })
      .slice((page - 1) * page_size, page * page_size)
      .map((row) => row.id);

    const rows = await prisma.lead.findMany({
      where: { id: { in: ordered } },
      select: LEAD_SELECT,
    });
    const derived = await derivedFor(prisma, ordered);
    const byId = new Map((rows as LeadRow[]).map((row) => [row.id, row]));
    return {
      rows: ordered.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toDto(row, derived.get(row.id))] : [];
      }),
      total: matching.length,
      page,
      page_size,
    };
  }

  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    paging.sort === 'name'
      ? [{ name: 'asc' }]
      : paging.sort === 'oldest'
        ? [{ created_at: 'asc' }]
        : [{ created_at: 'desc' }];

  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: LEAD_SELECT,
      orderBy,
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.lead.count({ where }),
  ]);

  const derived = await derivedFor(prisma, (rows as LeadRow[]).map((row) => row.id));
  return {
    rows: (rows as LeadRow[]).map((row) => toDto(row, derived.get(row.id))),
    total,
    page,
    page_size,
  };
}

export async function getLead(id: string): Promise<LeadDetailDto> {
  const row = await prisma.lead.findUnique({ where: { id }, select: LEAD_SELECT });
  if (!row) throw notFound('That lead');

  const [activities, derived, assignee, project, customer] = await Promise.all([
    prisma.leadActivity.findMany({
      where: { lead_id: id },
      select: ACTIVITY_SELECT,
      orderBy: [{ activity_date: 'asc' }, { created_at: 'asc' }],
    }),
    derivedFor(prisma, [id]),
    row.assigned_to
      ? prisma.user.findUnique({
          where: { id: row.assigned_to },
          select: { id: true, name: true, phone: true },
        })
      : null,
    row.interested_project_id
      ? prisma.project.findUnique({
          where: { id: row.interested_project_id },
          select: { id: true, code: true, name: true, location_summary: true },
        })
      : null,
    /*
     * The investor this lead became, found by the lead link first and by the
     * number second: a customer entered straight onto the share-sale screen
     * carries no `lead_id`, and the two records are still the same person.
     */
    prisma.customer.findFirst({
      where: { OR: [{ lead_id: id }, { phone: row.phone }] },
      select: { id: true, code: true, name: true },
      orderBy: { created_at: 'asc' },
    }),
  ]);

  const purchases = customer
    ? await prisma.shareSale.findMany({
        where: { customer_id: customer.id, deleted_at: null },
        select: { id: true, code: true, status: true, shares: true },
        orderBy: { created_at: 'desc' },
      })
    : [];

  return {
    ...toDto(row, derived.get(row.id)),
    activities: (activities as ActivityRow[]).map(toActivityDto),
    assignee,
    project,
    customer,
    purchases,
  };
}

/** The lead with this number, if there is one — the dedup warning on the form. */
export async function findLeadByPhone(phone: string): Promise<LeadDto | null> {
  const normalized = normalizePhone(phone);
  if (!isMobile(normalized)) return null;
  const row = await prisma.lead.findFirst({ where: { phone: normalized }, select: LEAD_SELECT });
  return row ? toDto(row) : null;
}

export interface LeadSummary {
  /** the call queue: leads past their follow-up date, and ones due today */
  overdue: number;
  due_today: number;
  /** open leads nobody owns — assignment is a manager's job (§9.6) */
  unassigned: number;
  /** how many leads sit at each status */
  by_status: Record<string, number>;
  total: number;
}

/**
 * The banner above the list and the sales desk's own count of its work.
 *
 * It reads the same queue the list's filters do, rather than counting raw
 * follow-up dates: a lead that is booked, lost, or already carries a live
 * purchase is not somebody to ring today, and counting it here made the two
 * screens disagree about how much work was outstanding.
 */
export async function leadSummary(
  today = new Date().toISOString().slice(0, 10),
): Promise<LeadSummary> {
  const [due, bought, grouped, unassigned] = await Promise.all([
    followUpDue(prisma),
    alreadyBought(prisma),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.lead.count({ where: { assigned_to: null, status: { notIn: CLOSED } } }),
  ]);

  let overdue = 0;
  let due_today = 0;
  for (const [id, date] of due) {
    if (bought.has(id)) continue;
    if (date < today) overdue += 1;
    else if (date === today) due_today += 1;
  }

  const by_status: Record<string, number> = {};
  let total = 0;
  for (const row of grouped as Array<{ status: LeadStatus; _count: { _all: number } }>) {
    by_status[row.status] = row._count._all;
    total += row._count._all;
  }

  return { overdue, due_today, unassigned, by_status, total };
}

/** Who the desk has to call, soonest first. */
export async function followUpQueue(
  today = new Date().toISOString().slice(0, 10),
): Promise<Array<{ lead: LeadDto; date: string }>> {
  const [due, bought] = await Promise.all([followUpDue(prisma), alreadyBought(prisma)]);
  const owing = [...due.entries()]
    .filter(([id, date]) => date <= today && !bought.has(id))
    .sort((a, b) => a[1].localeCompare(b[1]));

  if (owing.length === 0) return [];
  const ids = owing.map(([id]) => id);
  const [rows, derived] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: ids } }, select: LEAD_SELECT }),
    derivedFor(prisma, ids),
  ]);
  const byId = new Map((rows as LeadRow[]).map((row) => [row.id, row]));
  return owing.flatMap(([id, date]) => {
    const row = byId.get(id);
    return row ? [{ lead: toDto(row, derived.get(id)), date }] : [];
  });
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface LeadInput {
  name?: string;
  phone?: string;
  email?: string | null;
  source?: LeadSource;
  inquiry_message?: string | null;
  interested_project_id?: string | null;
  budget_range?: string | null;
  assigned_to?: string | null;
  page_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
}

function columnsFor(input: LeadInput): Prisma.LeadUncheckedUpdateInput {
  return {
    name: input.name?.trim(),
    phone: input.phone === undefined ? undefined : normalizePhone(input.phone),
    email: input.email === undefined ? undefined : (input.email?.trim().toLowerCase() || null),
    source: input.source,
    inquiry_message: input.inquiry_message,
    interested_project_id: input.interested_project_id || (input.interested_project_id === null ? null : undefined),
    budget_range: input.budget_range,
    assigned_to: input.assigned_to || (input.assigned_to === null ? null : undefined),
    page_url: input.page_url,
    utm_source: input.utm_source,
    utm_medium: input.utm_medium,
    utm_campaign: input.utm_campaign,
  };
}

/** The number has to be dialable, and nobody else's. */
async function assertPhoneFree(client: Tx, phone: string, exceptId?: string): Promise<void> {
  if (!isMobile(phone)) {
    throw invalid('That is not a Bangladeshi mobile number.', {
      phone: 'Eleven digits, starting 01.',
    });
  }
  /*
   * Deleted leads are looked at too: `leads.phone` is unique in the database
   * and a soft-deleted row still holds its number, so without this the service
   * would say the number was free and Postgres would then refuse the insert —
   * which reaches the person as "something went wrong" rather than as the one
   * thing they could act on.
   */
  const clash = await client.lead.findFirst({
    where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { code: true, name: true, deleted_at: true },
    includeDeleted: true,
  });
  if (clash) {
    throw invalid('A lead already has that number.', {
      phone: clash.deleted_at
        ? `${clash.name} (${clash.code}) had this number and was deleted. Ask an administrator to restore them.`
        : `${clash.name} (${clash.code}) has this number.`,
    });
  }
}

export interface CapturedInquiry {
  /** true when an existing lead absorbed the inquiry instead of a new row */
  merged: boolean;
  lead: LeadDto;
}

/**
 * The single door a new inquiry comes through — the admin form today, the
 * public website's enquiry form when it moves (Scope v3 §4.5 / §4.9).
 *
 * The number is looked up first. On a match the existing lead absorbs the
 * inquiry as an activity and no second row is created; otherwise a new lead is
 * opened at `new`. Both the browser's warning and this are the same rule, so
 * the one that actually decides is the server's.
 */
export async function captureInquiry(input: LeadInput): Promise<CapturedInquiry> {
  const name = input.name?.trim();
  if (!name) throw invalid('A lead needs a name.', { name: 'Who is this?' });
  if (!input.source) throw invalid('A lead needs a source.', { source: 'Where did it come from?' });
  const phone = normalizePhone(input.phone ?? '');
  if (!isMobile(phone)) {
    throw invalid('That is not a Bangladeshi mobile number.', {
      phone: 'Eleven digits, starting 01.',
    });
  }

  return withTx(async (tx: Tx) => {
    const existing = await tx.lead.findFirst({
      where: { phone },
      select: {
        id: true,
        interested_project_id: true,
        budget_range: true,
        email: true,
        status: true,
      },
    });

    if (existing) {
      /*
       * The repeat note has to say what this inquiry was about: the lead keeps
       * the project it was first opened against, so without naming the new one
       * the desk saw "repeat inquiry" and could not tell the investor had
       * moved on to a different project.
       */
      const project = input.interested_project_id
        ? await tx.project.findUnique({
            where: { id: input.interested_project_id },
            select: { id: true, code: true, name: true },
          })
        : null;

      await tx.leadActivity.create({
        data: {
          lead_id: existing.id,
          activity_type: 'other',
          activity_date: new Date(),
          // the newest entry sets the follow-up, so a null here would wipe a pending call
          next_follow_up_date: toDay(new Date().toISOString().slice(0, 10)),
          notes: [
            `Repeat inquiry via ${input.source!.replace(/_/g, ' ')} under the name "${name}"${
              project ? ` about ${project.name} (${project.code})` : ''
            }.`,
            input.budget_range ? `Budget: ${input.budget_range}.` : null,
            input.inquiry_message?.trim() || null,
          ]
            .filter(Boolean)
            .join(' '),
          created_by: currentActorId(),
        },
      });

      // fill what the lead is missing; never overwrite what the desk recorded
      const fill: Prisma.LeadUncheckedUpdateInput = {};
      if (!existing.interested_project_id && project) fill.interested_project_id = project.id;
      if (!existing.budget_range && input.budget_range) fill.budget_range = input.budget_range;
      if (!existing.email && input.email) fill.email = input.email.trim().toLowerCase();

      const lead = Object.keys(fill).length
        ? await tx.lead.update({ where: { id: existing.id }, data: fill, select: LEAD_SELECT })
        : await tx.lead.findUniqueOrThrow({ where: { id: existing.id }, select: LEAD_SELECT });
      return { merged: true, lead: toDto(lead) };
    }

    await assertPhoneFree(tx, phone);
    const lead = await tx.lead.create({
      data: {
        ...(columnsFor(input) as Prisma.LeadUncheckedCreateInput),
        name,
        phone,
        source: input.source!,
        status: 'new',
        code: await nextCode(tx, 'lead'),
        created_by: currentActorId(),
      },
      select: LEAD_SELECT,
    });
    return { merged: false, lead: toDto(lead) };
  });
}

export async function updateLead(id: string, input: LeadInput): Promise<LeadDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.lead.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw notFound('That lead');

    if (input.name !== undefined && !input.name.trim()) {
      throw invalid('A lead needs a name.', { name: 'Who is this?' });
    }
    if (input.phone !== undefined) {
      await assertPhoneFree(tx, normalizePhone(input.phone), id);
    }
    return tx.lead.update({ where: { id }, data: columnsFor(input), select: LEAD_SELECT });
  });

  const derived = await derivedFor(prisma, [row.id]);
  return toDto(row, derived.get(row.id));
}

/**
 * Moves the lead, and logs the move.
 *
 * `booked` is not reachable here: it follows a real share purchase, so a
 * status button must not be able to claim one (`domain/lead.ts`). Reviving a
 * lost lead is the same call with an earlier status, and keeps its history —
 * that is why nothing is deleted on the way.
 */
export async function setLeadStatus(
  id: string,
  status: LeadStatus,
  options: { notes: string; next_follow_up_date?: string | null } = { notes: '' },
): Promise<LeadDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.lead.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!current) throw notFound('That lead');
    if (status === 'booked') {
      throw conflict('A lead becomes booked by buying shares, not by changing its status.');
    }
    if (current.status === 'booked') {
      throw conflict(
        'This lead has bought shares. Release or cancel the purchase to move it out of Booked.',
      );
    }
    if (status === 'lost' && !options.notes.trim()) {
      throw invalid('A lost lead needs a reason.', { notes: 'Why did it drop out?' });
    }

    const notes = options.notes.trim();
    await tx.leadActivity.create({
      data: {
        lead_id: id,
        activity_type: 'status_change',
        activity_date: new Date(),
        next_follow_up_date: toDay(options.next_follow_up_date) ?? null,
        notes: `${current.status} → ${status}${notes ? `. ${notes}` : ''}`,
        created_by: currentActorId(),
      },
    });

    return tx.lead.update({
      where: { id },
      // the reason belongs to the lost state only; reviving clears it
      data: { status, lost_reason: status === 'lost' ? notes : null },
      select: LEAD_SELECT,
    });
  });

  const derived = await derivedFor(prisma, [row.id]);
  return toDto(row, derived.get(row.id));
}

export interface StageCompletion {
  to: LeadStatus;
  activity_type: LeadActivityType;
  /** the day the stage actually happened (YYYY-MM-DD) */
  event_date: string;
  title: string;
  details?: Record<string, string>;
  notes?: string;
  next_follow_up_date?: string | null;
  updates?: Pick<LeadInput, 'budget_range' | 'interested_project_id'>;
}

/**
 * Completes the lead's current stage (`domain/lead-stages.ts`): one log entry
 * carrying what happened in it, the lead's own record brought up to date, and
 * the lead moved on.
 *
 * The stage definitions stay in the shared domain module — this decides *when*
 * a stage may be completed and writes the two rows together.
 */
export async function completeLeadStage(
  id: string,
  input: StageCompletion,
): Promise<LeadDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.lead.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!current) throw notFound('That lead');
    if (input.to === 'booked') {
      throw conflict('A lead becomes booked by buying shares, not by completing a stage.');
    }
    if (current.status === 'booked' || current.status === 'lost') {
      throw conflict('This lead is closed. Revive it before working it again.');
    }

    /*
     * The day it happened, at the time it is being recorded: the log is read in
     * order, and a stage back-dated to midnight would sort behind entries made
     * earlier the same day.
     */
    const now = new Date();
    const at = new Date(`${input.event_date}T${now.toISOString().slice(11, 19)}Z`);
    if (Number.isNaN(at.getTime())) {
      throw invalid('That date could not be read.', { event_date: 'Use YYYY-MM-DD.' });
    }

    const notes = input.notes?.trim();
    await tx.leadActivity.create({
      data: {
        lead_id: id,
        activity_type: input.activity_type,
        activity_date: at,
        next_follow_up_date: toDay(input.next_follow_up_date) ?? null,
        notes: `${input.title}.${notes ? ` ${notes}` : ''}`,
        details:
          input.details && Object.keys(input.details).length
            ? (input.details as Prisma.InputJsonValue)
            : undefined,
        created_by: currentActorId(),
      },
    });

    return tx.lead.update({
      where: { id },
      data: {
        ...columnsFor(input.updates ?? {}),
        status: input.to,
        lost_reason: null,
      },
      select: LEAD_SELECT,
    });
  });

  const derived = await derivedFor(prisma, [row.id]);
  return toDto(row, derived.get(row.id));
}

/** Manual assignment (§4.7), logged like any other change. */
export async function assignLead(id: string, userId: string | null): Promise<LeadDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.lead.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw notFound('That lead');

    const user = userId
      ? await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
      : null;
    if (userId && !user) throw invalid('That person is not on the staff list.', { assigned_to: 'Pick somebody else.' });

    await tx.leadActivity.create({
      data: {
        lead_id: id,
        activity_type: 'status_change',
        activity_date: new Date(),
        notes: user ? `Assigned to ${user.name}.` : 'Assignment cleared.',
        created_by: currentActorId(),
      },
    });
    return tx.lead.update({
      where: { id },
      data: { assigned_to: userId },
      select: LEAD_SELECT,
    });
  });

  const derived = await derivedFor(prisma, [row.id]);
  return toDto(row, derived.get(row.id));
}

export interface ActivityInput {
  activity_type: LeadActivityType;
  notes: string;
  /** when it happened; defaults to now */
  activity_date?: string;
  next_follow_up_date?: string | null;
}

/** One entry in the follow-up log — a call, a message, a visit. */
export async function logLeadActivity(
  leadId: string,
  input: ActivityInput,
): Promise<LeadActivityDto> {
  const notes = input.notes?.trim();
  if (!notes) throw invalid('Write what happened.', { notes: 'What was said?' });
  if (input.activity_type === 'status_change') {
    throw invalid('A status change is logged by moving the lead, not by hand.', {
      activity_type: 'Pick what actually happened.',
    });
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw notFound('That lead');

  const at = input.activity_date ? new Date(input.activity_date) : new Date();
  if (Number.isNaN(at.getTime())) {
    throw invalid('That date could not be read.', { activity_date: 'Use a real date.' });
  }

  const row = await prisma.leadActivity.create({
    data: {
      lead_id: leadId,
      activity_type: input.activity_type,
      activity_date: at,
      next_follow_up_date: toDay(input.next_follow_up_date) ?? null,
      notes,
      created_by: currentActorId(),
    },
    select: ACTIVITY_SELECT,
  });
  return toActivityDto(row);
}

/**
 * Deletes a lead with its whole follow-up history.
 *
 * A lead that became an investor is not deleted: the customer, the agreement
 * and the receipts behind it all point back here. Marking it lost keeps the
 * history, which is almost always what was meant.
 */
export async function deleteLead(id: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const current = await tx.lead.findUnique({ where: { id }, select: { id: true, phone: true } });
    if (!current) throw notFound('That lead');

    const customers = await tx.customer.count({ where: { lead_id: id, deleted_at: null } });
    if (customers > 0) {
      throw conflict(
        'This lead became an investor. Delete the customer record first, or mark the lead lost instead.',
      );
    }

    await tx.document.updateMany({
      where: { entity_type: 'lead', entity_id: id, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    await tx.lead.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}

/* ------------------------------------------------------------------ *
 * Lead → investor
 * ------------------------------------------------------------------ */

export interface ConversionResult {
  /** true when the lead was already on file as an investor */
  existing: boolean;
  customer: { id: string; code: string; name: string; phone: string };
  lead: LeadDto;
}

/**
 * Makes the investor from the lead — the hand-over between the two halves of
 * the journey (SALES-FLOW-PLAN.md).
 *
 * Both tables key on the phone number, so this is mostly bookkeeping: if
 * somebody with that number is already on file, they *are* this lead's
 * investor and the two records are linked rather than a second one being made.
 * Either way the lead keeps its status — `booked` follows a real purchase, not
 * the making of a customer file — and the log records that it happened, so the
 * next person can see where the lead went.
 */
export async function convertLeadToCustomer(
  id: string,
  input: { name?: string; email?: string | null; assigned_to?: string | null } = {},
): Promise<ConversionResult> {
  const result = await withTx(async (tx: Tx) => {
    const lead = await tx.lead.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, phone: true, email: true, status: true },
    });
    if (!lead) throw notFound('That lead');
    if (lead.status === 'lost') {
      throw conflict('This lead is marked lost. Revive it before making an investor from it.');
    }

    const onFile = await tx.customer.findFirst({
      where: { phone: lead.phone },
      select: { id: true, code: true, name: true, phone: true, lead_id: true },
    });

    if (onFile) {
      if (!onFile.lead_id) {
        await tx.customer.update({ where: { id: onFile.id }, data: { lead_id: lead.id } });
      }
      await tx.leadActivity.create({
        data: {
          lead_id: lead.id,
          activity_type: 'other',
          activity_date: new Date(),
          notes: `Already on file as investor ${onFile.code} — ${onFile.name}. The two records are linked.`,
          created_by: currentActorId(),
        },
      });
      return { existing: true, customer: onFile, lead_id: lead.id };
    }

    const customer = await tx.customer.create({
      data: {
        code: await nextCode(tx, 'customer'),
        name: input.name?.trim() || lead.name,
        phone: lead.phone,
        email: (input.email ?? lead.email)?.trim().toLowerCase() || null,
        customer_type: 'investor',
        lead_id: lead.id,
        created_by: currentActorId(),
      },
      select: { id: true, code: true, name: true, phone: true },
    });

    await tx.leadActivity.create({
      data: {
        lead_id: lead.id,
        activity_type: 'other',
        activity_date: new Date(),
        notes: `Investor file ${customer.code} opened from this lead.`,
        created_by: currentActorId(),
      },
    });

    return { existing: false, customer, lead_id: lead.id };
  });

  const row = await prisma.lead.findUniqueOrThrow({
    where: { id: result.lead_id },
    select: LEAD_SELECT,
  });
  const derived = await derivedFor(prisma, [row.id]);
  return {
    existing: result.existing,
    customer: {
      id: result.customer.id,
      code: result.customer.code,
      name: result.customer.name,
      phone: result.customer.phone,
    },
    lead: toDto(row, derived.get(row.id)),
  };
}
