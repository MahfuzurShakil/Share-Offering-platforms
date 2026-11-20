import { z } from 'zod';

/**
 * What may be sent about an account and a partner.
 *
 * Not here: `code` (the series gives it), and anything that would let a caller
 * state a balance. An account's running figure is worked out from the
 * payments that name it, and a partner's percentage changes through a dated
 * change rather than an edit — which is why `effective_from` sits beside
 * `share_pct` and the service refuses one without the other.
 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-21.');
const text = (max: number) => z.string().trim().max(max).nullable();

export const AccountFields = z.object({
  name: z.string().trim().min(2, 'What is it called?').max(200),
  type: z.enum(['bank', 'mfs', 'cash']),
  bank_name: text(200),
  account_number: text(60),
  branch: text(200),
  opening_balance: z.number().min(0).max(1_000_000_000_000),
  opening_balance_date: dateOnly,
  is_active: z.boolean(),
  notes: text(4000),
});

export const AccountCreate = AccountFields.partial().extend({
  name: AccountFields.shape.name,
  opening_balance_date: AccountFields.shape.opening_balance_date,
});

export const AccountUpdate = AccountFields.partial();

export const PartnerFields = z.object({
  name: z.string().trim().min(2, 'Who is this?').max(200),
  phone: text(20),
  nid: text(40),
  /** of the company, or of `project_id` where that is set */
  share_pct: z.number().positive('How much?').max(100),
  /** an investor in this project only; null = a partner of the whole company */
  project_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  notes: text(4000),
  /** the day a changed share takes effect — required when `share_pct` moves */
  effective_from: dateOnly,
  note: text(2000),
});

export const PartnerCreate = PartnerFields.partial().extend({
  name: PartnerFields.shape.name,
  share_pct: PartnerFields.shape.share_pct,
});

export const PartnerUpdate = PartnerFields.partial();
