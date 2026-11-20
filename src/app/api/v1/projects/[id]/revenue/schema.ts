import { z } from 'zod';

/**
 * What may be sent about a project's profit sharing.
 *
 * Not here: anything on the statement. Income less cost, the past loss, the
 * reserve, the fee and what is left are worked out from the entries and the
 * policy (REVENUE-SHARE-PLAN.md §2.3) — a caller who could send those could
 * declare a profit the project never made.
 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-31.');

export const PolicyBody = z.object({
  entry_frequency: z.enum(['daily', 'monthly', 'quarterly']).optional(),
  distribution_frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']).optional(),
  first_period_start: dateOnly.optional(),
  reserve_pct: z.number().min(0).max(100).optional(),
  mgmt_fee_type: z.enum(['none', 'pct_income', 'pct_profit', 'fixed']).optional(),
  mgmt_fee_value: z.number().min(0).optional(),
  tax_withholding_pct: z.number().min(0).max(100).optional(),
  loss_rule: z.enum(['recover_first', 'ignore']).optional(),
  eligibility_rule: z.enum(['fully_paid', 'pro_rata_paid', 'all_signed']).optional(),
  prorate_days: z.boolean().optional(),
  repay_loans_first: z.boolean().optional(),
  min_withdrawal: z.number().min(0).optional(),
  withdrawal_window: z.enum(['any_time', 'after_declare', 'day_of_month']).optional(),
  withdrawal_window_days: z.number().int().min(0).max(31).optional(),
  adjust_overdue_first: z.boolean().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const EntryBody = z.object({
  entry_date: dateOnly,
  direction: z.enum(['income', 'cost']),
  head: z.string().trim().min(1, 'Pick what it was for.').max(120),
  amount: z.number().positive('How much.'),
  account_id: z.string().uuid().nullable().optional(),
  reference_no: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const ClosePeriodBody = z.object({
  period_start: dateOnly,
});

export const PeriodMoveBody = z.object({
  action: z.enum(['approve', 'declare', 'reopen']),
  /** approve: how much of what is available will be shared */
  declared: z.number().min(0).optional(),
  /** declare: the day ownership is read on; the period's last day by default */
  record_date: dateOnly.optional(),
});
