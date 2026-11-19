import { Prisma } from '@prisma/client';
import { isMobile, normalizePhone } from '@/lib/domain/phone';
import { currentActorId } from '../audit/audit';
import { prisma, withTx, type Tx } from '../db/prisma';
import { conflict, invalid, notFound } from '../http/respond';
import { nextCode } from '../numbering/code-series';

/**
 * Customers — the investors (PROJECT-SHARE-SALE-PLAN.md §4 step 5).
 *
 * One person, one record, across every project they buy into: a customer who
 * holds shares in two projects has two purchases and one file. That is why the
 * phone number is unique and why this service goes to some trouble over it —
 * "01711 22 33 44" and "+8801711223344" are the same investor, and a second
 * record for them would split their holdings, their papers and their payouts.
 *
 * What the office records at the signing table — NID, e-TIN, nominee, bank —
 * is kept here too, once, and serves every purchase (plan §4a).
 */

/* ------------------------------------------------------------------ *
 * What the wire carries
 * ------------------------------------------------------------------ */

const CUSTOMER_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  email: true,
  customer_type: true,
  lead_id: true,
  nid: true,
  tin: true,
  date_of_birth: true,
  father_or_spouse_name: true,
  profession: true,
  address: true,
  permanent_address: true,
  kyc_verified_on: true,
  nominee_name: true,
  nominee_relation: true,
  nominee_phone: true,
  nominee_nid: true,
  bank_name: true,
  bank_branch: true,
  bank_account: true,
  last_login_at: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.CustomerSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

/** What this investor holds, across every project. */
export interface CustomerHoldings {
  /** purchases that still stand */
  purchases: number;
  shares: number;
  /** what those purchases are worth, what has been paid, what is left */
  value: number;
  paid: number;
  due: number;
}

export interface CustomerDto {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  customer_type: string;
  lead_id: string | null;
  nid: string | null;
  tin: string | null;
  date_of_birth: string | null;
  father_or_spouse_name: string | null;
  profession: string | null;
  address: string | null;
  permanent_address: string | null;
  kyc_verified_on: string | null;
  nominee_name: string | null;
  nominee_relation: string | null;
  nominee_phone: string | null;
  nominee_nid: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  /** whether they have ever signed in to the Customer Portal */
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  holdings: CustomerHoldings;
}

const EMPTY_HOLDINGS: CustomerHoldings = {
  purchases: 0,
  shares: 0,
  value: 0,
  paid: 0,
  due: 0,
};

const day = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));
const toDate = (value: string | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(`${value}T00:00:00.000Z`);
};

function toDto(row: CustomerRow, holdings: CustomerHoldings = EMPTY_HOLDINGS): CustomerDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    email: row.email,
    customer_type: row.customer_type,
    lead_id: row.lead_id,
    nid: row.nid,
    tin: row.tin,
    date_of_birth: day(row.date_of_birth),
    father_or_spouse_name: row.father_or_spouse_name,
    profession: row.profession,
    address: row.address,
    permanent_address: row.permanent_address,
    kyc_verified_on: day(row.kyc_verified_on),
    nominee_name: row.nominee_name,
    nominee_relation: row.nominee_relation,
    nominee_phone: row.nominee_phone,
    nominee_nid: row.nominee_nid,
    bank_name: row.bank_name,
    bank_branch: row.bank_branch,
    bank_account: row.bank_account,
    last_login_at: row.last_login_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    holdings,
  };
}

/* ------------------------------------------------------------------ *
 * What they hold
 * ------------------------------------------------------------------ */

/** Purchases that still stand. A released or cancelled one holds nothing. */
const LIVE: Prisma.ShareSaleWhereInput['status'] = {
  in: ['reserved', 'agreement_signed', 'fully_paid'],
};

/**
 * Each of these customers' live purchases and what has been paid against them.
 *
 * Two grouped queries for the whole page, not one per row: the list shows
 * "3 purchases · ৳1.2 crore · ৳40 lakh due" on every line, and adding that up
 * in the browser is what the move to Postgres is for. The sum of payments is
 * net of reversals, because a reversing receipt is a negative row.
 */
async function holdingsFor(
  client: Tx,
  customerIds: string[],
): Promise<Map<string, CustomerHoldings>> {
  const out = new Map<string, CustomerHoldings>();
  if (customerIds.length === 0) return out;

  const sales = await client.shareSale.findMany({
    where: { customer_id: { in: customerIds }, deleted_at: null, status: LIVE },
    select: { id: true, customer_id: true, shares: true, total_price: true },
  });
  if (sales.length === 0) return out;

  const paid = await client.sharePayment.groupBy({
    by: ['sale_id'],
    where: { sale_id: { in: sales.map((s: { id: string }) => s.id) } },
    _sum: { amount: true },
  });
  const paidBySale = new Map<string, number>(
    (paid as { sale_id: string; _sum: { amount: Prisma.Decimal | null } }[]).map((row) => [
      row.sale_id,
      row._sum.amount?.toNumber() ?? 0,
    ]),
  );

  for (const sale of sales as {
    id: string;
    customer_id: string;
    shares: number;
    total_price: Prisma.Decimal;
  }[]) {
    const row = out.get(sale.customer_id) ?? { ...EMPTY_HOLDINGS };
    row.purchases += 1;
    row.shares += sale.shares;
    row.value += sale.total_price.toNumber();
    row.paid += paidBySale.get(sale.id) ?? 0;
    out.set(sale.customer_id, row);
  }
  for (const row of out.values()) row.due = Math.max(0, row.value - row.paid);
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface CustomerFilters {
  /**
   * One field per thing somebody might know. A single box mixing them all
   * matched too loosely and made the results feel random (prototype QA).
   */
  name?: string;
  phone?: string;
  nid?: string;
  profession?: string;
  /** by what they hold: anybody, nobody, holding, or signed */
  holding_state?: 'any' | 'none' | 'active' | 'signed';
}

export type CustomerSort = 'newest' | 'oldest' | 'name';

export interface CustomerPage {
  rows: CustomerDto[];
  total: number;
  page: number;
  page_size: number;
}

function whereFor(filters: CustomerFilters): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};

  const name = filters.name?.trim();
  if (name) {
    // the name box also matches the code and the email: that is what people type there
    where.OR = [
      { name: { contains: name, mode: 'insensitive' } },
      { code: { contains: name, mode: 'insensitive' } },
      { email: { contains: name, mode: 'insensitive' } },
    ];
  }
  const phone = filters.phone?.trim();
  if (phone) where.phone = { contains: normalizePhone(phone) };
  const nid = filters.nid?.trim();
  if (nid) where.nid = { contains: nid, mode: 'insensitive' };
  const profession = filters.profession?.trim();
  if (profession) where.profession = { contains: profession, mode: 'insensitive' };

  switch (filters.holding_state) {
    case 'none':
      where.sales = { none: { deleted_at: null, status: LIVE } };
      break;
    case 'active':
      where.sales = { some: { deleted_at: null, status: LIVE } };
      break;
    case 'signed':
      where.sales = {
        some: { deleted_at: null, status: { in: ['agreement_signed', 'fully_paid'] } },
      };
      break;
    default:
      break;
  }
  return where;
}

export async function listCustomers(
  filters: CustomerFilters = {},
  paging: { page?: number; page_size?: number; sort?: CustomerSort } = {},
): Promise<CustomerPage> {
  const page = Math.max(1, paging.page ?? 1);
  const page_size = Math.min(200, Math.max(1, paging.page_size ?? 50));
  const where = whereFor(filters);

  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    paging.sort === 'name'
      ? [{ name: 'asc' }]
      : paging.sort === 'oldest'
        ? [{ created_at: 'asc' }]
        : [{ created_at: 'desc' }];

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: CUSTOMER_SELECT,
      orderBy,
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    prisma.customer.count({ where }),
  ]);

  const holdings = await holdingsFor(prisma, rows.map((r: CustomerRow) => r.id));
  return {
    rows: rows.map((row: CustomerRow) => toDto(row, holdings.get(row.id))),
    total,
    page,
    page_size,
  };
}

export async function getCustomer(id: string): Promise<CustomerDto> {
  const row = await prisma.customer.findUnique({ where: { id }, select: CUSTOMER_SELECT });
  if (!row) throw notFound('That customer');
  const holdings = await holdingsFor(prisma, [row.id]);
  return toDto(row, holdings.get(row.id));
}

/**
 * The customer with this phone number, if there is one.
 *
 * The form asks as the number is typed, so somebody entering an investor who
 * is already on file is told before they fill the rest in — and sent to the
 * existing record rather than making a second one.
 */
export async function findByPhone(phone: string): Promise<CustomerDto | null> {
  const normalized = normalizePhone(phone);
  if (!isMobile(normalized)) return null;
  const row = await prisma.customer.findFirst({
    where: { phone: normalized },
    select: CUSTOMER_SELECT,
  });
  return row ? toDto(row) : null;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface CustomerInput {
  name?: string;
  phone?: string;
  email?: string | null;
  lead_id?: string | null;
  nid?: string | null;
  tin?: string | null;
  date_of_birth?: string | null;
  father_or_spouse_name?: string | null;
  profession?: string | null;
  address?: string | null;
  permanent_address?: string | null;
  kyc_verified_on?: string | null;
  nominee_name?: string | null;
  nominee_relation?: string | null;
  nominee_phone?: string | null;
  nominee_nid?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_account?: string | null;
}

/** The columns a customer is written with. `undefined` means "leave it". */
function columnsFor(input: CustomerInput): Prisma.CustomerUncheckedUpdateInput {
  return {
    name: input.name?.trim(),
    phone: input.phone === undefined ? undefined : normalizePhone(input.phone),
    email: input.email === undefined ? undefined : (input.email?.trim().toLowerCase() || null),
    lead_id: input.lead_id,
    nid: input.nid,
    tin: input.tin,
    date_of_birth: toDate(input.date_of_birth),
    father_or_spouse_name: input.father_or_spouse_name,
    profession: input.profession,
    address: input.address,
    permanent_address: input.permanent_address,
    kyc_verified_on: toDate(input.kyc_verified_on),
    nominee_name: input.nominee_name,
    nominee_relation: input.nominee_relation,
    nominee_phone:
      input.nominee_phone === undefined
        ? undefined
        : (input.nominee_phone ? normalizePhone(input.nominee_phone) : null),
    nominee_nid: input.nominee_nid,
    bank_name: input.bank_name,
    bank_branch: input.bank_branch,
    bank_account: input.bank_account,
  };
}

/** The phone number has to be dialable, and nobody else's. */
async function assertPhoneFree(client: Tx, phone: string, exceptId?: string): Promise<void> {
  if (!isMobile(phone)) {
    throw invalid('That is not a Bangladeshi mobile number.', {
      phone: 'Eleven digits, starting 01.',
    });
  }
  /*
   * Deleted records are looked at too. `customers.phone` is unique in the
   * database, and a soft-deleted row still holds its number — so without this
   * the service would say the number was free and Postgres would then refuse
   * the insert, which reaches the person as "something went wrong" instead of
   * as the one thing they could act on.
   */
  const clash = await client.customer.findFirst({
    where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { code: true, name: true, deleted_at: true },
    includeDeleted: true,
  });
  if (clash) {
    throw invalid('Somebody is already on file with that number.', {
      phone: clash.deleted_at
        ? `${clash.name} (${clash.code}) had this number and was deleted. Ask an administrator to restore them.`
        : `${clash.name} (${clash.code}) has this number.`,
    });
  }
}

export async function createCustomer(input: CustomerInput): Promise<CustomerDto> {
  const name = input.name?.trim();
  if (!name) throw invalid('A customer needs a name.', { name: 'Who is this?' });
  const phone = normalizePhone(input.phone ?? '');

  const row = await withTx(async (tx: Tx) => {
    await assertPhoneFree(tx, phone);
    return tx.customer.create({
      data: {
        ...(columnsFor(input) as Prisma.CustomerUncheckedCreateInput),
        name,
        phone,
        code: await nextCode(tx, 'customer'),
        customer_type: 'investor',
        created_by: currentActorId(),
      },
      select: CUSTOMER_SELECT,
    });
  });

  return toDto(row);
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<CustomerDto> {
  const row = await withTx(async (tx: Tx) => {
    const current = await tx.customer.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw notFound('That customer');

    const name = input.name?.trim();
    if (input.name !== undefined && !name) {
      throw invalid('A customer needs a name.', { name: 'Who is this?' });
    }
    if (input.phone !== undefined) {
      await assertPhoneFree(tx, normalizePhone(input.phone), id);
    }

    return tx.customer.update({ where: { id }, data: columnsFor(input), select: CUSTOMER_SELECT });
  });

  const holdings = await holdingsFor(prisma, [row.id]);
  return toDto(row, holdings.get(row.id));
}

/**
 * Deletes a customer who has bought nothing.
 *
 * Somebody with purchases is not deleted: their agreement, their receipts and
 * their shares all point at this row. Release or cancel the purchases first,
 * which is a decision somebody has to make deliberately.
 */
export async function deleteCustomer(id: string): Promise<void> {
  await withTx(async (tx: Tx) => {
    const current = await tx.customer.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw notFound('That customer');

    const purchases = await tx.shareSale.count({ where: { customer_id: id, deleted_at: null } });
    if (purchases > 0) {
      throw conflict(
        `This customer has ${purchases} share purchase${purchases === 1 ? '' : 's'}. Release or cancel those first.`,
      );
    }

    await tx.document.updateMany({
      where: { entity_type: 'customer', entity_id: id, deleted_at: null },
      data: { deleted_at: new Date() },
    });
    await tx.customer.update({ where: { id }, data: { deleted_at: new Date() } });
  });
}
