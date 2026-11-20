import type { Prisma } from '@prisma/client';

/**
 * Display codes — `PRJ-2026-001`, `SHR-2026-014`.
 *
 * The number comes from `code_series`, allocated with
 * `UPDATE ... SET next_no = next_no + 1 RETURNING next_no` **inside the same
 * transaction as the record being written**. The row lock Postgres takes on
 * that UPDATE serialises two people saving at once, so a number is never
 * handed out twice. The prototype kept a high-water mark in the browser's
 * localStorage, which could not do that.
 *
 * Because the counter is bumped by that UPDATE and not by a Postgres sequence,
 * a transaction that fails gives its number back: the series is **gapless**,
 * which is what an auditor here expects of a receipt book. The cost is that
 * the series row stays locked until the transaction commits, so writes that
 * take a code queue behind each other — fine for records a person saves, and
 * the reason a numbered write must not sit inside a long transaction.
 *
 * `scripts/check-code-gaps.ts` still watches for gaps, because a gap would
 * mean something else went wrong — a row deleted, or a code set by hand.
 */

export interface CodeSeriesSpec {
  /** what is being numbered, e.g. 'project' */
  module: string;
  /** the letters in front, e.g. 'PRJ' */
  prefix: string;
  /** how many digits the number is padded to */
  width?: number;
  /** the period the series restarts on; a year by default */
  period?: string;
}

/** The series every numbered record in this product draws from. */
export const CODE_SERIES = {
  project: { module: 'project', prefix: 'PRJ', width: 3 },
  customer: { module: 'customer', prefix: 'CUST', width: 3 },
  lead: { module: 'lead', prefix: 'LED', width: 3 },
  share_offering: { module: 'share_offering', prefix: 'OFR', width: 3 },
  share_sale: { module: 'share_sale', prefix: 'SHR', width: 3 },
  share_payment: { module: 'share_payment', prefix: 'SRC', width: 4 },
  /** the signed agreement behind a purchase, and the certificate that ends it */
  agreement: { module: 'agreement', prefix: 'AGR', width: 3 },
  certificate: { module: 'certificate', prefix: 'CRT', width: 3 },
  share_request: { module: 'share_request', prefix: 'SRQ', width: 3 },
  payment_submission: { module: 'payment_submission', prefix: 'PSB', width: 3 },
  revenue_entry: { module: 'revenue_entry', prefix: 'REV', width: 4 },
  revenue_period: { module: 'revenue_period', prefix: 'RVP', width: 3 },
  profit_withdrawal: { module: 'profit_withdrawal', prefix: 'WDR', width: 3 },
  loan: { module: 'loan', prefix: 'LON', width: 3 },
  loan_repayment: { module: 'loan_repayment', prefix: 'LRP', width: 3 },
  fund_receipt: { module: 'fund_receipt', prefix: 'FND', width: 3 },
  fund_allocation: { module: 'fund_allocation', prefix: 'ALC', width: 3 },
  org_member: { module: 'org_member', prefix: 'ORG', width: 3 },
  commission_plan: { module: 'commission_plan', prefix: 'CMP', width: 3 },
  commission_payout: { module: 'commission_payout', prefix: 'CPO', width: 3 },
  journal_entry: { module: 'journal_entry', prefix: 'JV', width: 4 },
  bank_account: { module: 'bank_account', prefix: 'ACC', width: 2 },
  partner: { module: 'partner', prefix: 'PTR', width: 2 },
} as const;

export type CodeSeriesKey = keyof typeof CODE_SERIES;

/** The year a code is stamped with, from a date or today. */
export function periodOf(date: Date = new Date()): string {
  return String(date.getUTCFullYear());
}

/**
 * Takes the next code in a series. Must be called with a transaction client —
 * the point of it is that the number and the record commit together.
 *
 * ```ts
 * await prisma.$transaction(async (tx) => {
 *   const code = await nextCode(tx, 'project');
 *   return tx.project.create({ data: { code, ...input } });
 * });
 * ```
 */
export async function nextCode(
  tx: Prisma.TransactionClient,
  key: CodeSeriesKey,
  at: Date = new Date(),
): Promise<string> {
  const spec: CodeSeriesSpec = CODE_SERIES[key];
  const period = spec.period ?? periodOf(at);
  const width = spec.width ?? 3;

  const rows = await tx.$queryRaw<{ next_no: number }[]>`
    INSERT INTO code_series (id, module, prefix, period, next_no, width, created_at, updated_at)
    VALUES (gen_random_uuid(), ${spec.module}, ${spec.prefix}, ${period}, 2, ${width}, now(), now())
    ON CONFLICT (module, period)
      DO UPDATE SET next_no = code_series.next_no + 1, updated_at = now()
    RETURNING (code_series.next_no - 1)::int AS next_no
  `;

  const issued = rows[0]?.next_no;
  if (issued === undefined) throw new Error(`Could not allocate a ${spec.prefix} code.`);
  return `${spec.prefix}-${period}-${String(issued).padStart(width, '0')}`;
}
