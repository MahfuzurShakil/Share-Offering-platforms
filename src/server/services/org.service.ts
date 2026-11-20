import { Prisma } from '@prisma/client';
import { descendantsOf, wouldLoop } from '@/lib/domain/commission';
import { normalizePhone } from '@/lib/domain/phone';
import { currentActorId } from '../audit/audit';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';

/**
 * The sales organisation — who sold it, and who they report to
 * (REVENUE-SHARE-PLAN.md §6).
 *
 * A free tree of any depth under designations the client names and orders in
 * Master Data: twenty founders each with a lead under them is one shape, two
 * levels is another, and nothing in the code depends on a particular name.
 *
 * The part that matters most is the smallest: **a move is recorded, not
 * applied silently.** `parent_id` is only today's answer; `org_moves` holds
 * the day each change took effect, and commission is read from the tree *as it
 * was on the sale date* (`domain/commission.ts::chainOn`). Without that,
 * moving a sales person to a new lead would quietly move every override they
 * ever earned to the new lead as well.
 */

export const ORG_DESIGNATION = 'org_designation';

/* ------------------------------------------------------------------ *
 * What the wire carries
 * ------------------------------------------------------------------ */

const MEMBER_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  designation_id: true,
  parent_id: true,
  user_id: true,
  partner_id: true,
  joined_on: true,
  left_on: true,
  status: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.OrgMemberSelect;

type MemberRow = Prisma.OrgMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

export type OrgMemberStatus = MemberRow['status'];

const day = (value: Date) => value.toISOString().slice(0, 10);
const dayOrNull = (value: Date | null) => (value === null ? null : day(value));
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export interface OrgMemberDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  designation_id: string;
  /** the designation's label and rank, so a row needs no second request */
  designation: string;
  rank: number;
  parent_id: string | null;
  parent_name: string | null;
  user_id: string | null;
  user_name: string | null;
  partner_id: string | null;
  joined_on: string;
  left_on: string | null;
  status: OrgMemberStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;

  /** what they sold themselves */
  own_sales: number;
  own_sales_count: number;
  /** how many people sit under them, at any depth */
  team_size: number;
  /** their own sales plus their whole team's */
  branch_sales: number;
  branch_sales_count: number;
}

/** The tree, as the org chart draws it. */
export interface OrgNode extends OrgMemberDto {
  children: OrgNode[];
}

/* ------------------------------------------------------------------ *
 * Sales per member
 * ------------------------------------------------------------------ */

/** A sale counts once it holds what was sold: not released, not cancelled. */
const LIVE_SALE = ['reserved', 'agreement_signed', 'fully_paid'] as const;

/**
 * What each member sold, added up by Postgres.
 *
 * One grouped query for the whole chart rather than one per node: the org
 * chart shows a figure on every branch, and a tree of a hundred people would
 * otherwise be a hundred queries.
 */
async function salesByMember(client: Tx): Promise<Map<string, { amount: number; count: number }>> {
  const rows = await client.shareSale.groupBy({
    by: ['sold_by_member_id'],
    where: { deleted_at: null, status: { in: LIVE_SALE }, sold_by_member_id: { not: null } },
    _sum: { total_price: true },
    _count: { _all: true },
  });
  return new Map(
    (
      rows as Array<{
        sold_by_member_id: string | null;
        _sum: { total_price: Prisma.Decimal | null };
        _count: { _all: number };
      }>
    ).map((row) => [
      row.sold_by_member_id as string,
      { amount: row._sum.total_price?.toNumber() ?? 0, count: row._count._all },
    ]),
  );
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

interface Context {
  designation: Map<string, { value: string; sort_order: number }>;
  userName: Map<string, string>;
  sales: Map<string, { amount: number; count: number }>;
}

async function contextFor(client: Tx): Promise<Context> {
  const [designations, users, sales] = await Promise.all([
    client.lookupValue.findMany({
      where: { category: ORG_DESIGNATION },
      select: { id: true, value: true, sort_order: true },
      orderBy: { sort_order: 'asc' },
    }),
    client.user.findMany({ select: { id: true, name: true } }),
    salesByMember(client),
  ]);
  return {
    designation: new Map(
      (designations as Array<{ id: string; value: string; sort_order: number }>).map((row) => [
        row.id,
        { value: row.value, sort_order: row.sort_order },
      ]),
    ),
    userName: new Map((users as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])),
    sales,
  };
}

function toDto(
  row: MemberRow,
  context: Context,
  parentName: string | null,
  team: { size: number; sales: number; count: number },
): OrgMemberDto {
  const designation = context.designation.get(row.designation_id);
  const own = context.sales.get(row.id) ?? { amount: 0, count: 0 };
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    designation_id: row.designation_id,
    designation: designation?.value ?? '—',
    rank: designation?.sort_order ?? 99,
    parent_id: row.parent_id,
    parent_name: parentName,
    user_id: row.user_id,
    user_name: row.user_id ? (context.userName.get(row.user_id) ?? null) : null,
    partner_id: row.partner_id,
    joined_on: day(row.joined_on),
    left_on: dayOrNull(row.left_on),
    status: row.status,
    notes: row.notes,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    own_sales: own.amount,
    own_sales_count: own.count,
    team_size: team.size,
    branch_sales: own.amount + team.sales,
    branch_sales_count: own.count + team.count,
  };
}

/** Every member, in the order the list shows them: active first, then rank, then name. */
async function allMembers(client: Tx, context: Context): Promise<MemberRow[]> {
  const rows = (await client.orgMember.findMany({ select: MEMBER_SELECT })) as MemberRow[];
  return rows.sort(
    (a, b) =>
      Number(a.status === 'left') - Number(b.status === 'left') ||
      (context.designation.get(a.designation_id)?.sort_order ?? 99) -
        (context.designation.get(b.designation_id)?.sort_order ?? 99) ||
      a.name.localeCompare(b.name),
  );
}

/** Everyone under each member, at any depth, with what their branch sold. */
function branchTotals(
  members: MemberRow[],
  sales: Map<string, { amount: number; count: number }>,
): Map<string, { size: number; sales: number; count: number }> {
  const out = new Map<string, { size: number; sales: number; count: number }>();
  for (const member of members) {
    const under = descendantsOf(member.id, members);
    out.set(member.id, {
      size: under.length,
      sales: under.reduce((total, id) => total + (sales.get(id)?.amount ?? 0), 0),
      count: under.reduce((total, id) => total + (sales.get(id)?.count ?? 0), 0),
    });
  }
  return out;
}

export interface MemberFilters {
  designation_id?: string;
  status?: OrgMemberStatus | 'all';
  /** name, code or phone */
  search?: string;
}

export async function listMembers(filters: MemberFilters = {}): Promise<OrgMemberDto[]> {
  const context = await contextFor(prisma);
  const members = await allMembers(prisma, context);
  const totals = branchTotals(members, context.sales);
  const byId = new Map(members.map((row) => [row.id, row]));

  const search = filters.search?.trim().toLowerCase();
  const digits = search ? normalizePhone(search) : '';

  return members
    .filter((row) => {
      if (filters.designation_id && row.designation_id !== filters.designation_id) return false;
      if (filters.status && filters.status !== 'all' && row.status !== filters.status) return false;
      if (search) {
        const matchesText = [row.name, row.code].some((field) =>
          field.toLowerCase().includes(search),
        );
        const matchesPhone = digits.length >= 3 && (row.phone ?? '').includes(digits);
        if (!matchesText && !matchesPhone) return false;
      }
      return true;
    })
    .map((row) =>
      toDto(
        row,
        context,
        row.parent_id ? (byId.get(row.parent_id)?.name ?? null) : null,
        totals.get(row.id) ?? { size: 0, sales: 0, count: 0 },
      ),
    );
}

/**
 * The tree, with team sizes and sales per branch.
 *
 * A member whose parent has been deleted is shown at the top rather than lost,
 * and the `seen` set stops a cycle from recursing for ever — the database
 * cannot have one (`wouldLoop` refuses it on the way in), but a tree read is
 * not the place to find out.
 */
export async function orgTree(): Promise<OrgNode[]> {
  const context = await contextFor(prisma);
  const members = await allMembers(prisma, context);
  const totals = branchTotals(members, context.sales);
  const byId = new Map(members.map((row) => [row.id, row]));
  const ids = new Set(members.map((row) => row.id));

  const seen = new Set<string>();
  const build = (row: MemberRow): OrgNode => {
    seen.add(row.id);
    return {
      ...toDto(
        row,
        context,
        row.parent_id ? (byId.get(row.parent_id)?.name ?? null) : null,
        totals.get(row.id) ?? { size: 0, sales: 0, count: 0 },
      ),
      children: members.filter((child) => child.parent_id === row.id && !seen.has(child.id)).map(build),
    };
  };

  return members.filter((row) => !row.parent_id || !ids.has(row.parent_id)).map(build);
}

export async function getMember(id: string): Promise<OrgMemberDto> {
  const row = await prisma.orgMember.findUnique({ where: { id }, select: MEMBER_SELECT });
  if (!row) throw notFound('That member');
  const context = await contextFor(prisma);
  const members = await allMembers(prisma, context);
  const totals = branchTotals(members, context.sales);
  const parent = row.parent_id ? members.find((m) => m.id === row.parent_id) : undefined;
  return toDto(row, context, parent?.name ?? null, totals.get(row.id) ?? { size: 0, sales: 0, count: 0 });
}

export interface OrgMoveDto {
  id: string;
  member_id: string;
  from_parent_id: string | null;
  from_parent_name: string | null;
  to_parent_id: string | null;
  to_parent_name: string | null;
  effective_date: string;
  note: string | null;
  created_at: string;
}

/** Who reported where, newest first. */
export async function memberHistory(memberId: string): Promise<OrgMoveDto[]> {
  const member = await prisma.orgMember.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!member) throw notFound('That member');

  const rows = await prisma.orgMove.findMany({
    where: { member_id: memberId },
    orderBy: [{ effective_date: 'desc' }, { created_at: 'desc' }],
    include: {
      member: { select: { id: true } },
    },
  });

  const parentIds = [
    ...new Set(
      (rows as Array<{ from_parent_id: string | null; to_parent_id: string | null }>)
        .flatMap((row) => [row.from_parent_id, row.to_parent_id])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const names = new Map(
    (
      (await prisma.orgMember.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, name: true },
      })) as Array<{ id: string; name: string }>
    ).map((row) => [row.id, row.name]),
  );

  return (
    rows as Array<{
      id: string;
      member_id: string;
      from_parent_id: string | null;
      to_parent_id: string | null;
      effective_date: Date;
      note: string | null;
      created_at: Date;
    }>
  ).map((row) => ({
    id: row.id,
    member_id: row.member_id,
    from_parent_id: row.from_parent_id,
    from_parent_name: row.from_parent_id ? (names.get(row.from_parent_id) ?? null) : null,
    to_parent_id: row.to_parent_id,
    to_parent_name: row.to_parent_id ? (names.get(row.to_parent_id) ?? null) : null,
    effective_date: day(row.effective_date),
    note: row.note,
    created_at: row.created_at.toISOString(),
  }));
}

/** The member a staff login belongs to, if any — a sale's seller defaults from it. */
export async function memberForUser(userId: string | null | undefined): Promise<OrgMemberDto | null> {
  if (!userId) return null;
  const row = await prisma.orgMember.findFirst({
    where: { user_id: userId, status: 'active' },
    select: { id: true },
  });
  return row ? getMember(row.id) : null;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface MemberInput {
  name?: string;
  phone?: string | null;
  designation_id?: string;
  parent_id?: string | null;
  user_id?: string | null;
  partner_id?: string | null;
  joined_on?: string;
  notes?: string | null;
}

async function assertDesignation(client: Tx, id: string): Promise<void> {
  const row = await client.lookupValue.findFirst({
    where: { id, category: ORG_DESIGNATION },
    select: { id: true },
  });
  if (!row) throw invalid('Pick a designation.', { designation_id: 'That is not a designation.' });
}

async function assertParentUsable(client: Tx, parentId: string): Promise<void> {
  const parent = await client.orgMember.findUnique({
    where: { id: parentId },
    select: { name: true, status: true },
  });
  if (!parent) {
    throw invalid('The person they report to no longer exists.', { parent_id: 'Pick somebody else.' });
  }
  if (parent.status === 'left') {
    throw invalid(`${parent.name} has left the team.`, { parent_id: 'Pick somebody still in it.' });
  }
}

/** One login, one member: two members sharing it would split their sales. */
async function assertLoginFree(client: Tx, userId: string, exceptId?: string): Promise<void> {
  const clash = await client.orgMember.findFirst({
    where: {
      user_id: userId,
      status: 'active',
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { code: true, name: true },
  });
  if (clash) {
    throw invalid(`${clash.name} (${clash.code}) is already that login.`, {
      user_id: 'Pick another, or leave it empty.',
    });
  }
}

export async function createMember(input: MemberInput): Promise<OrgMemberDto> {
  const name = input.name?.trim();
  if (!name) throw invalid('A member needs a name.', { name: 'Who is this?' });
  if (!input.designation_id) throw invalid('Pick a designation.', { designation_id: 'What are they?' });
  if (!input.joined_on) throw invalid('Enter the day they joined.', { joined_on: 'When did they start?' });

  const row = await withTx(async (tx: Tx) => {
    await assertDesignation(tx, input.designation_id!);
    if (input.parent_id) await assertParentUsable(tx, input.parent_id);
    if (input.user_id) await assertLoginFree(tx, input.user_id);

    return tx.orgMember.create({
      data: {
        code: await nextCode(tx, 'org_member'),
        name,
        phone: input.phone ? normalizePhone(input.phone) : null,
        designation_id: input.designation_id!,
        parent_id: input.parent_id ?? null,
        user_id: input.user_id ?? null,
        partner_id: input.partner_id ?? null,
        joined_on: toDate(input.joined_on!),
        notes: input.notes?.trim() || null,
        status: 'active',
        created_by: currentActorId(),
      },
      select: { id: true },
    });
  });

  return getMember(row.id);
}

/**
 * Changes a member's own details.
 *
 * Who they report to is *not* among them: that goes through `moveMember`, so
 * the change has a date and lands in the history. A form that lets somebody
 * edit the reporting line in place would lose exactly the fact commission
 * depends on.
 */
export async function updateMember(id: string, input: MemberInput): Promise<OrgMemberDto> {
  await withTx(async (tx: Tx) => {
    const current = await tx.orgMember.findUnique({
      where: { id },
      select: { id: true, joined_on: true, left_on: true },
    });
    if (!current) throw notFound('That member');

    if (input.name !== undefined && !input.name.trim()) {
      throw invalid('A member needs a name.', { name: 'Who is this?' });
    }
    if (input.designation_id) await assertDesignation(tx, input.designation_id);
    if (input.user_id) await assertLoginFree(tx, input.user_id, id);
    if (input.joined_on && current.left_on && toDate(input.joined_on) > current.left_on) {
      throw invalid('They cannot have joined after they left.', {
        joined_on: `They left on ${day(current.left_on)}.`,
      });
    }

    await tx.orgMember.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        phone:
          input.phone === undefined ? undefined : input.phone ? normalizePhone(input.phone) : null,
        designation_id: input.designation_id,
        user_id: input.user_id === undefined ? undefined : (input.user_id || null),
        partner_id: input.partner_id === undefined ? undefined : (input.partner_id || null),
        joined_on: input.joined_on ? toDate(input.joined_on) : undefined,
        notes: input.notes === undefined ? undefined : (input.notes?.trim() || null),
      },
    });
  });

  return getMember(id);
}

/**
 * Puts a member under somebody else from a date. Their whole team moves with
 * them, and the old place is written down.
 *
 * A move may not be back-dated behind the previous one: the chain on a date is
 * read as "the last move on or before it", so an out-of-order move would
 * change what an already-earned commission says happened.
 */
export async function moveMember(
  id: string,
  input: { to_parent_id: string | null; effective_date: string; note?: string | null },
): Promise<OrgMemberDto> {
  if (!input.effective_date) {
    throw invalid('Enter the date the move takes effect.', { effective_date: 'From when?' });
  }

  await withTx(async (tx: Tx) => {
    const member = await tx.orgMember.findUnique({
      where: { id },
      select: { id: true, name: true, parent_id: true },
    });
    if (!member) throw notFound('That member');

    const to = input.to_parent_id ?? null;
    if (to === member.parent_id) {
      throw conflict(`${member.name} already reports there.`);
    }

    const everybody = (await tx.orgMember.findMany({
      select: { id: true, parent_id: true },
    })) as Array<{ id: string; parent_id: string | null }>;
    if (wouldLoop(id, to, everybody)) {
      throw invalid(`${member.name} cannot report to somebody in their own team.`, {
        to_parent_id: 'Pick somebody outside it.',
      });
    }
    if (to) await assertParentUsable(tx, to);

    const last = await tx.orgMove.findFirst({
      where: { member_id: id },
      orderBy: [{ effective_date: 'desc' }, { created_at: 'desc' }],
      select: { effective_date: true },
    });
    if (last && toDate(input.effective_date) < last.effective_date) {
      throw invalid(`${member.name} last moved on ${day(last.effective_date)}.`, {
        effective_date: 'A new move must be on or after that day.',
      });
    }

    await tx.orgMove.create({
      data: {
        member_id: id,
        from_parent_id: member.parent_id,
        to_parent_id: to,
        effective_date: toDate(input.effective_date),
        note: input.note?.trim() || null,
        created_by: currentActorId(),
      },
    });
    await tx.orgMember.update({ where: { id }, data: { parent_id: to } });
  });

  return getMember(id);
}

/**
 * Marks a member as having left.
 *
 * Their team has to be moved first, so nobody is left reporting to somebody
 * who is gone. They are not deleted and never will be: their name is on every
 * commission line they earned.
 */
export async function markMemberLeft(id: string, leftOn: string): Promise<OrgMemberDto> {
  await withTx(async (tx: Tx) => {
    const member = await tx.orgMember.findUnique({
      where: { id },
      select: { id: true, name: true, joined_on: true },
    });
    if (!member) throw notFound('That member');
    if (!leftOn) throw invalid('Enter the day they left.', { left_on: 'When did they go?' });
    if (toDate(leftOn) < member.joined_on) {
      throw invalid('They cannot leave before they joined.', {
        left_on: `They joined on ${day(member.joined_on)}.`,
      });
    }

    const team = await tx.orgMember.count({ where: { parent_id: id, status: 'active' } });
    if (team > 0) {
      throw conflict(
        `${team} ${team === 1 ? 'person reports' : 'people report'} to ${member.name}. Move them under somebody else first.`,
      );
    }

    await tx.orgMember.update({
      where: { id },
      data: { status: 'left', left_on: toDate(leftOn) },
    });
  });

  return getMember(id);
}

export async function rejoinMember(id: string): Promise<OrgMemberDto> {
  const member = await prisma.orgMember.findUnique({ where: { id }, select: { id: true } });
  if (!member) throw notFound('That member');
  await prisma.orgMember.update({ where: { id }, data: { status: 'active', left_on: null } });
  return getMember(id);
}

/**
 * Deletes a member who never sold anything and earned nothing.
 *
 * Anybody else stays: the commission lines, the payouts and the sales all name
 * them. "They have left" is the answer for a real person who is gone, and this
 * is only for a row that should never have been typed.
 */
export async function deleteMember(id: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const member = await tx.orgMember.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!member) throw notFound('That member');

    const [sales, lines, reports] = await Promise.all([
      tx.shareSale.count({ where: { sold_by_member_id: id, deleted_at: null } }),
      tx.commissionLine.count({ where: { member_id: id } }),
      tx.orgMember.count({ where: { parent_id: id } }),
    ]);
    if (sales > 0 || lines > 0) {
      throw conflict(
        `${member.name} has sales or commission against their name. Mark them as having left instead.`,
      );
    }
    if (reports > 0) {
      throw conflict('Somebody reports to them. Move that person first.');
    }

    await tx.orgMember.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}

/**
 * Who sold a share purchase.
 *
 * Once commission on it has been earned the seller is fixed: those lines
 * already belong to somebody, and re-pointing the sale would take money off
 * one person and give it to another without a trace. While everything is still
 * `pending`, nothing has been promised and the seller may be corrected.
 */
export async function setSoldBy(saleId: string, memberId: string | null): Promise<void> {
  await withTx(async (tx: Tx) => {
    const sale = await tx.shareSale.findUnique({ where: { id: saleId }, select: { id: true } });
    if (!sale) throw notFound('That purchase');

    if (memberId) {
      const member = await tx.orgMember.findUnique({
        where: { id: memberId },
        select: { status: true },
      });
      if (!member || member.status !== 'active') {
        throw invalid('Pick somebody still in the sales team.', {
          sold_by_member_id: 'They are not an active member.',
        });
      }
    }

    const lines = (await tx.commissionLine.findMany({
      where: { share_sale_id: saleId },
      select: { member_id: true, role: true, status: true },
    })) as Array<{ member_id: string; role: string; status: string }>;
    const seller = lines.find((line) => line.role === 'seller');
    if (
      seller &&
      seller.member_id !== memberId &&
      lines.some((line) => line.status !== 'pending')
    ) {
      throw conflict(
        'Commission on this purchase has already been earned, so who sold it cannot change.',
      );
    }

    await tx.shareSale.update({ where: { id: saleId }, data: { sold_by_member_id: memberId } });
  });
}

/** Members under this one, at any depth, by today's tree. */
export async function teamIds(memberId: string): Promise<string[]> {
  const members = (await prisma.orgMember.findMany({
    select: { id: true, parent_id: true },
  })) as Array<{ id: string; parent_id: string | null }>;
  return descendantsOf(memberId, members);
}
