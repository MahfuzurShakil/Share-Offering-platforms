import { Prisma } from '@prisma/client';
import {
  ownerSlices,
  partnersOn,
  splitProject,
  type PartnerShare,
  type ShareChange,
  type ShareSlice,
} from '@/lib/domain/partners';
import { normalizePhone } from '@/lib/domain/phone';
import { currentActorId } from '../audit/audit';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';

/**
 * Money — where the company's money sits, and who owns the rest of a project
 * (REVENUE-SHARE-PLAN.md §4).
 *
 * This is the slice the modules already built were waiting for. A commission
 * payout and a profit withdrawal both carry an `account_id` that had nothing
 * to point at; the owners' side of a profit declaration was a single line
 * because nobody knew who the owners were. Both columns were already there.
 *
 * The split itself is in `src/lib/domain/partners.ts`, shared with the browser:
 * a project investor takes their share of that project first, and the
 * company's partners divide what is left in their company proportions. A
 * change to a percentage carries the day it took effect, so a declaration made
 * in June is not re-split by a change made in October.
 */

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

const ACCOUNT_SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  bank_name: true,
  account_number: true,
  branch: true,
  opening_balance: true,
  opening_balance_date: true,
  is_active: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.BankAccountSelect;

type AccountRow = Prisma.BankAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export type BankAccountType = AccountRow['type'];

const num = (value: Prisma.Decimal | null) => (value === null ? 0 : value.toNumber());
const day = (value: Date) => value.toISOString().slice(0, 10);
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export interface BankAccountDto {
  id: string;
  code: string;
  name: string;
  type: BankAccountType;
  bank_name: string | null;
  account_number: string | null;
  branch: string | null;
  opening_balance: number;
  opening_balance_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** what has been paid out of it that this product knows about */
  paid_out: number;
}

const toAccountDto = (row: AccountRow, paidOut = 0): BankAccountDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  bank_name: row.bank_name,
  account_number: row.account_number,
  branch: row.branch,
  opening_balance: num(row.opening_balance),
  opening_balance_date: day(row.opening_balance_date),
  is_active: row.is_active,
  notes: row.notes,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
  paid_out: paidOut,
});

/**
 * What has left each account.
 *
 * Only what this product records so far: profit paid to holders and commission
 * paid to the sales team. Money *in* arrives with fund receipts in the next
 * slice, so this is deliberately not called a balance — a half-counted
 * balance is worse than none, and nothing here claims to be one.
 */
async function paidOutByAccount(client: Tx): Promise<Map<string, number>> {
  const [withdrawals, payouts] = await Promise.all([
    client.profitWithdrawal.groupBy({
      by: ['account_id'],
      where: { status: 'paid', account_id: { not: null }, deleted_at: null },
      _sum: { amount: true },
    }),
    client.commissionPayout.groupBy({
      by: ['account_id'],
      where: { account_id: { not: null } },
      _sum: { net: true },
    }),
  ]);

  const out = new Map<string, number>();
  const add = (id: string | null, amount: number) => {
    if (!id) return;
    out.set(id, (out.get(id) ?? 0) + amount);
  };
  for (const row of withdrawals as Array<{
    account_id: string | null;
    _sum: { amount: Prisma.Decimal | null };
  }>) {
    add(row.account_id, row._sum.amount?.toNumber() ?? 0);
  }
  for (const row of payouts as Array<{
    account_id: string | null;
    _sum: { net: Prisma.Decimal | null };
  }>) {
    add(row.account_id, row._sum.net?.toNumber() ?? 0);
  }
  return out;
}

export async function listAccounts(
  filters: { is_active?: boolean } = {},
): Promise<BankAccountDto[]> {
  const [rows, paidOut] = await Promise.all([
    prisma.bankAccount.findMany({
      where: filters.is_active === undefined ? {} : { is_active: filters.is_active },
      select: ACCOUNT_SELECT,
      orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
    }),
    paidOutByAccount(prisma),
  ]);
  return (rows as AccountRow[]).map((row) => toAccountDto(row, paidOut.get(row.id) ?? 0));
}

export async function getAccount(id: string): Promise<BankAccountDto> {
  const row = await prisma.bankAccount.findUnique({ where: { id }, select: ACCOUNT_SELECT });
  if (!row) throw notFound('That account');
  const paidOut = await paidOutByAccount(prisma);
  return toAccountDto(row, paidOut.get(row.id) ?? 0);
}

export interface AccountInput {
  name?: string;
  type?: BankAccountType;
  bank_name?: string | null;
  account_number?: string | null;
  branch?: string | null;
  opening_balance?: number;
  opening_balance_date?: string;
  is_active?: boolean;
  notes?: string | null;
}

function accountColumns(input: AccountInput): Prisma.BankAccountUncheckedUpdateInput {
  return {
    name: input.name?.trim(),
    type: input.type,
    bank_name: input.bank_name === undefined ? undefined : (input.bank_name?.trim() || null),
    account_number:
      input.account_number === undefined ? undefined : (input.account_number?.trim() || null),
    branch: input.branch === undefined ? undefined : (input.branch?.trim() || null),
    opening_balance: input.opening_balance,
    opening_balance_date: input.opening_balance_date
      ? toDate(input.opening_balance_date)
      : undefined,
    is_active: input.is_active,
    notes: input.notes === undefined ? undefined : (input.notes?.trim() || null),
  };
}

export async function createAccount(input: AccountInput): Promise<BankAccountDto> {
  const name = input.name?.trim();
  if (!name) throw invalid('An account needs a name.', { name: 'What is it called?' });
  if (!input.opening_balance_date) {
    throw invalid('Say what day the opening balance was true on.', {
      opening_balance_date: 'As of when?',
    });
  }

  const row = await withTx(async (tx: Tx) =>
    tx.bankAccount.create({
      data: {
        ...(accountColumns(input) as Prisma.BankAccountUncheckedCreateInput),
        name,
        opening_balance: input.opening_balance ?? 0,
        opening_balance_date: toDate(input.opening_balance_date!),
        code: await nextCode(tx, 'bank_account'),
        created_by: currentActorId(),
      },
      select: { id: true },
    }),
  );
  return getAccount(row.id);
}

export async function updateAccount(id: string, input: AccountInput): Promise<BankAccountDto> {
  await withTx(async (tx: Tx) => {
    const current = await tx.bankAccount.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw notFound('That account');
    if (input.name !== undefined && !input.name.trim()) {
      throw invalid('An account needs a name.', { name: 'What is it called?' });
    }
    await tx.bankAccount.update({ where: { id }, data: accountColumns(input) });
  });
  return getAccount(id);
}

/**
 * Deletes an account nothing has been paid out of.
 *
 * Anything else is switched off instead: the payouts and withdrawals that name
 * it are the record of money leaving, and a dangling account id would make
 * them unreadable.
 */
export async function deleteAccount(id: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const account = await tx.bankAccount.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!account) throw notFound('That account');

    const [withdrawals, payouts] = await Promise.all([
      tx.profitWithdrawal.count({ where: { account_id: id } }),
      tx.commissionPayout.count({ where: { account_id: id } }),
    ]);
    const used = withdrawals + payouts;
    if (used > 0) {
      throw conflict(
        `${used} payment${used === 1 ? '' : 's'} came out of ${account.name}. Switch the account off instead of deleting it.`,
      );
    }
    await tx.bankAccount.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}

/* ------------------------------------------------------------------ *
 * Partners
 * ------------------------------------------------------------------ */

const PARTNER_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  nid: true,
  share_pct: true,
  project_id: true,
  is_active: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.PartnerSelect;

type PartnerRow = Prisma.PartnerGetPayload<{ select: typeof PARTNER_SELECT }>;

export interface PartnerDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  nid: string | null;
  /** of the company, or of `project_id` where that is set */
  share_pct: number;
  project_id: string | null;
  project_name: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const toPartnerDto = (row: PartnerRow, projectName: string | null = null): PartnerDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  phone: row.phone,
  nid: row.nid,
  share_pct: num(row.share_pct),
  project_id: row.project_id,
  project_name: projectName,
  is_active: row.is_active,
  notes: row.notes,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

async function partnersWithProjects(
  client: Tx,
  where: Prisma.PartnerWhereInput = {},
): Promise<PartnerDto[]> {
  const rows = (await client.partner.findMany({
    where,
    select: PARTNER_SELECT,
    orderBy: [{ is_active: 'desc' }, { share_pct: 'desc' }, { name: 'asc' }],
  })) as PartnerRow[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.project_id).filter((id): id is string => Boolean(id)))];
  const names = new Map(
    (
      (await client.project.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })) as Array<{ id: string; name: string }>
    ).map((row) => [row.id, row.name]),
  );
  return rows.map((row) =>
    toPartnerDto(row, row.project_id ? (names.get(row.project_id) ?? null) : null),
  );
}

export async function listPartners(
  filters: { is_active?: boolean; project_id?: string; company_only?: boolean } = {},
): Promise<PartnerDto[]> {
  const where: Prisma.PartnerWhereInput = {};
  if (filters.is_active !== undefined) where.is_active = filters.is_active;
  if (filters.company_only) where.project_id = null;
  else if (filters.project_id) where.project_id = filters.project_id;
  return partnersWithProjects(prisma, where);
}

export async function getPartner(id: string): Promise<PartnerDto> {
  const rows = await partnersWithProjects(prisma, { id });
  const row = rows[0];
  if (!row) throw notFound('That partner');
  return row;
}

export interface PartnerInput {
  name?: string;
  phone?: string | null;
  nid?: string | null;
  share_pct?: number;
  project_id?: string | null;
  is_active?: boolean;
  notes?: string | null;
  /**
   * The day a changed percentage takes effect. Required when `share_pct`
   * moves: without it the service could not tell an earlier declaration from
   * a later one.
   */
  effective_from?: string;
  note?: string | null;
}

export async function createPartner(input: PartnerInput): Promise<PartnerDto> {
  const name = input.name?.trim();
  if (!name) throw invalid('A partner needs a name.', { name: 'Who is this?' });
  if (input.share_pct === undefined) {
    throw invalid('Say what share they hold.', { share_pct: 'How much?' });
  }
  if (!(input.share_pct > 0 && input.share_pct <= 100)) {
    throw invalid('A share is more than 0 and at most 100%.', { share_pct: 'Between 0 and 100.' });
  }

  const row = await withTx(async (tx: Tx) => {
    if (input.project_id) {
      const project = await tx.project.findUnique({
        where: { id: input.project_id },
        select: { id: true },
      });
      if (!project) {
        throw invalid('That project no longer exists.', { project_id: 'Pick another.' });
      }
    }

    const partner = await tx.partner.create({
      data: {
        code: await nextCode(tx, 'partner'),
        name,
        phone: input.phone ? normalizePhone(input.phone) : null,
        nid: input.nid?.trim() || null,
        share_pct: input.share_pct!,
        project_id: input.project_id ?? null,
        is_active: input.is_active ?? true,
        notes: input.notes?.trim() || null,
        created_by: currentActorId(),
      },
      select: { id: true },
    });

    /*
     * The opening percentage is written into the history as well, from the day
     * they came in. Without it, a declaration dated before their first change
     * would have nothing on file to read and would fall back to today's
     * figure — which is the thing the history exists to prevent.
     */
    await tx.partnerShareHistory.create({
      data: {
        partner_id: partner.id,
        share_pct: input.share_pct!,
        effective_from: toDate(input.effective_from ?? new Date().toISOString().slice(0, 10)),
        note: input.note?.trim() || 'Opening share',
        created_by: currentActorId(),
      },
    });
    return partner;
  });

  return getPartner(row.id);
}

/**
 * Changes a partner.
 *
 * A changed percentage is not an edit, it is a dated change: the old figure
 * stays in the history and the new one takes effect from a day somebody has to
 * name. Everything else — the name, the phone, whether they are still active —
 * is an ordinary correction.
 */
export async function updatePartner(id: string, input: PartnerInput): Promise<PartnerDto> {
  await withTx(async (tx: Tx) => {
    const current = (await tx.partner.findUnique({
      where: { id },
      select: { id: true, name: true, share_pct: true },
    })) as { id: string; name: string; share_pct: Prisma.Decimal } | null;
    if (!current) throw notFound('That partner');

    if (input.name !== undefined && !input.name.trim()) {
      throw invalid('A partner needs a name.', { name: 'Who is this?' });
    }

    const moving = input.share_pct !== undefined && input.share_pct !== num(current.share_pct);
    if (moving) {
      if (!(input.share_pct! > 0 && input.share_pct! <= 100)) {
        throw invalid('A share is more than 0 and at most 100%.', {
          share_pct: 'Between 0 and 100.',
        });
      }
      if (!input.effective_from) {
        throw invalid('Say what day the new share takes effect.', {
          effective_from: 'From when?',
        });
      }

      const last = await tx.partnerShareHistory.findFirst({
        where: { partner_id: id },
        orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
        select: { effective_from: true },
      });
      if (last && toDate(input.effective_from) < last.effective_from) {
        throw invalid(`${current.name}'s share last changed on ${day(last.effective_from)}.`, {
          effective_from: 'A new change must be on or after that day.',
        });
      }

      await tx.partnerShareHistory.create({
        data: {
          partner_id: id,
          share_pct: input.share_pct!,
          effective_from: toDate(input.effective_from),
          note: input.note?.trim() || null,
          created_by: currentActorId(),
        },
      });
    }

    await tx.partner.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        phone:
          input.phone === undefined ? undefined : input.phone ? normalizePhone(input.phone) : null,
        nid: input.nid === undefined ? undefined : (input.nid?.trim() || null),
        share_pct: moving ? input.share_pct : undefined,
        is_active: input.is_active,
        notes: input.notes === undefined ? undefined : (input.notes?.trim() || null),
      },
    });
  });

  return getPartner(id);
}

/**
 * Deletes a partner who has never been credited anything.
 *
 * Anybody else is switched off: their name is on the profit they were
 * allocated, and a declaration whose lines no longer add up to what was
 * declared is the one thing the profit module exists to prevent.
 */
export async function deletePartner(id: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const partner = await tx.partner.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!partner) throw notFound('That partner');

    const [allocations, withdrawals] = await Promise.all([
      tx.profitAllocation.count({ where: { partner_id: id } }),
      tx.profitWithdrawal.count({ where: { partner_id: id } }),
    ]);
    if (allocations + withdrawals > 0) {
      throw conflict(
        `${partner.name} has been credited profit. Switch them off instead of deleting them.`,
      );
    }
    await tx.partner.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}

export interface ShareChangeDto {
  id: string;
  partner_id: string;
  share_pct: number;
  effective_from: string;
  note: string | null;
  created_at: string;
}

/** How a partner's share has moved, newest first. */
export async function partnerHistory(id: string): Promise<ShareChangeDto[]> {
  const partner = await prisma.partner.findUnique({ where: { id }, select: { id: true } });
  if (!partner) throw notFound('That partner');

  const rows = (await prisma.partnerShareHistory.findMany({
    where: { partner_id: id },
    orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      partner_id: true,
      share_pct: true,
      effective_from: true,
      note: true,
      created_at: true,
    },
  })) as Array<{
    id: string;
    partner_id: string;
    share_pct: Prisma.Decimal;
    effective_from: Date;
    note: string | null;
    created_at: Date;
  }>;

  return rows.map((row) => ({
    id: row.id,
    partner_id: row.partner_id,
    share_pct: num(row.share_pct),
    effective_from: day(row.effective_from),
    note: row.note,
    created_at: row.created_at.toISOString(),
  }));
}

/* ------------------------------------------------------------------ *
 * The cap table
 * ------------------------------------------------------------------ */

/** The partners as they stood on a day, in the shape the domain split takes. */
export async function partnerSharesOn(
  client: Tx,
  date: string,
): Promise<PartnerShare[]> {
  const [partners, changes] = await Promise.all([
    client.partner.findMany({
      select: { id: true, name: true, share_pct: true, project_id: true, is_active: true },
    }),
    client.partnerShareHistory.findMany({
      select: {
        partner_id: true,
        share_pct: true,
        effective_from: true,
        created_at: true,
      },
      orderBy: [{ effective_from: 'asc' }, { created_at: 'asc' }],
    }),
  ]);

  const shapes: PartnerShare[] = (
    partners as Array<{
      id: string;
      name: string;
      share_pct: Prisma.Decimal;
      project_id: string | null;
      is_active: boolean;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    share_pct: num(row.share_pct),
    project_id: row.project_id,
    is_active: row.is_active,
  }));

  const history: ShareChange[] = (
    changes as Array<{
      partner_id: string;
      share_pct: Prisma.Decimal;
      effective_from: Date;
      created_at: Date;
    }>
  ).map((row) => ({
    partner_id: row.partner_id,
    share_pct: num(row.share_pct),
    effective_from: day(row.effective_from),
    created_at: row.created_at.toISOString(),
  }));

  return partnersOn(shapes, history, date);
}

/**
 * The owners' slices of one project on a date, scaled to the part the
 * customers do not hold.
 *
 * This is what a declaration reads on its record date, and what the cap table
 * screen shows. `held` comes from the purchases, which the profit module
 * already works out — passing it in rather than reading it again keeps one
 * answer to "how much do the customers hold".
 */
export async function ownersOfProject(
  client: Tx,
  projectId: string,
  held: number,
  date: string,
): Promise<ShareSlice[]> {
  return ownerSlices(projectId, await partnerSharesOn(client, date), held);
}

export interface CapTableRow {
  kind: 'customer' | 'partner';
  key: string;
  name: string;
  /** what the holder is, in words: "2,000 shares" or "50% of the company" */
  basis: string;
  share_pct: number;
}

export interface CapTable {
  project_id: string;
  project_name: string;
  as_of: string;
  /** 100% minus what the customers hold */
  owners_pct: number;
  rows: CapTableRow[];
  /** should always be 100, and a screen that shows otherwise is a bug */
  total_pct: number;
}

/**
 * Who owns a project, always adding to 100% (plan §4).
 *
 * Customers first, by what they bought; then the owners' part, split by
 * partner. A purchase that was released or cancelled holds nothing and its
 * share has already gone back to the owners, which is why only the live
 * statuses are counted.
 */
export async function capTable(projectId: string, asOf?: string): Promise<CapTable> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, total_shares: true },
  });
  if (!project) throw notFound('That project');

  const sales = (await prisma.shareSale.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      status: { in: ['reserved', 'agreement_signed', 'fully_paid'] },
      reserved_on: { lte: toDate(date) },
    },
    select: {
      id: true,
      shares: true,
      share_pct: true,
      customer: { select: { id: true, name: true, code: true } },
    },
  })) as Array<{
    id: string;
    shares: number;
    share_pct: Prisma.Decimal;
    customer: { id: string; name: string; code: string };
  }>;

  /** one row per investor, however many purchases they made */
  const byCustomer = new Map<string, { name: string; code: string; shares: number; pct: number }>();
  for (const sale of sales) {
    const at = byCustomer.get(sale.customer.id) ?? {
      name: sale.customer.name,
      code: sale.customer.code,
      shares: 0,
      pct: 0,
    };
    at.shares += sale.shares;
    at.pct += num(sale.share_pct);
    byCustomer.set(sale.customer.id, at);
  }

  const held = [...byCustomer.values()].reduce((total, row) => total + row.pct, 0);
  const owners = await ownersOfProject(prisma, projectId, held, date);

  const rows: CapTableRow[] = [
    ...[...byCustomer.entries()]
      .sort((a, b) => b[1].pct - a[1].pct)
      .map(([id, row]) => ({
        kind: 'customer' as const,
        key: id,
        name: `${row.name} (${row.code})`,
        basis: `${row.shares} share${row.shares === 1 ? '' : 's'}`,
        share_pct: Math.round(row.pct * 1e6) / 1e6,
      })),
    ...owners.map((slice) => ({
      kind: 'partner' as const,
      key: slice.partner_id,
      name: slice.name,
      basis:
        slice.kind === 'investor'
          ? `${slice.company_pct ?? slice.share_pct}% of this project`
          : `${slice.company_pct}% of the company`,
      share_pct: slice.share_pct,
    })),
  ];

  return {
    project_id: project.id,
    project_name: project.name,
    as_of: date,
    owners_pct: Math.round(Math.max(0, 100 - held) * 1e6) / 1e6,
    rows,
    total_pct: Math.round(rows.reduce((total, row) => total + row.share_pct, 0) * 1e6) / 1e6,
  };
}

/** Re-exported so a caller does not have to reach past the service. */
export { splitProject };
