import { z } from 'zod';

/**
 * What may be sent about the sales organisation and its commission plans.
 *
 * Two things are deliberately not here. A member's `parent_id` cannot be
 * changed through the member route — it goes through `move`, which carries the
 * date the change took effect, because commission is read from the tree as it
 * was on the sale date. And `status` is not a field anybody sets: a member
 * leaves through `status` with the day they left, which is checked against the
 * day they joined and against who still reports to them.
 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-21.');
const text = (max: number) => z.string().trim().max(max).nullable();

export const MemberFields = z.object({
  name: z.string().trim().min(2, 'Who is this?').max(200),
  phone: text(20),
  designation_id: z.string().uuid('Pick a designation.'),
  /** null = top level */
  parent_id: z.string().uuid().nullable(),
  /** the staff login they are, where they have one */
  user_id: z.string().uuid().nullable(),
  /** the company partner they are (Fund & Partners, S4) */
  partner_id: z.string().uuid().nullable(),
  joined_on: dateOnly,
  notes: text(4000),
});

export const MemberCreate = MemberFields.partial().extend({
  name: MemberFields.shape.name,
  designation_id: MemberFields.shape.designation_id,
  joined_on: MemberFields.shape.joined_on,
});

/** `parent_id` is not updatable here; use the move route. */
export const MemberUpdate = MemberFields.omit({ parent_id: true }).partial();

export const MemberMove = z.object({
  to_parent_id: z.string().uuid().nullable(),
  effective_date: dateOnly,
  note: text(2000).optional(),
});

export const MemberStatusChange = z
  .object({
    status: z.enum(['active', 'left']),
    left_on: dateOnly.optional(),
  })
  .refine((value) => value.status !== 'left' || Boolean(value.left_on), {
    message: 'Enter the day they left.',
    path: ['left_on'],
  });

/* ------------------------------------------------------------------ *
 * Commission plans
 * ------------------------------------------------------------------ */

const Stage = z.object({
  /** stable within the plan; the lines point at it */
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1, 'Every stage needs a name.').max(200),
  trigger: z.enum([
    'agreement',
    'down_payment',
    'agreement_down_payment',
    'paid_pct',
    'fully_paid',
    'handover',
  ]),
  /** with `paid_pct`: the share of the price paid */
  threshold_pct: z.number().min(0).max(100).nullable().optional(),
  release_type: z.enum(['pct', 'fixed']),
  release_value: z.number().min(0),
});

const Override = z.object({
  designation_id: z.string().uuid(),
  basis: z.enum(['pct', 'per_share', 'per_sale']),
  value: z.number().positive(),
});

export const PlanFields = z.object({
  name: z.string().trim().min(2, 'What is it called?').max(200),
  applies_to: z.enum(['share_sale', 'booking']),
  /** null = every project: the default plan */
  project_id: z.string().uuid().nullable(),
  /** share sales only: one round */
  offering_id: z.string().uuid().nullable(),
  seller_basis: z.enum(['pct', 'per_share', 'per_sale']),
  seller_value: z.number().min(0).max(100_000_000),
  stages: z.array(Stage).max(12),
  overrides: z.array(Override).max(20),
  cancel_rule: z.enum(['recover', 'write_off']),
  effective_from: dateOnly,
  effective_to: dateOnly.nullable(),
  status: z.enum(['draft', 'active', 'retired']),
  notes: text(4000),
});

export const PlanCreate = PlanFields.partial().extend({
  name: PlanFields.shape.name,
  effective_from: PlanFields.shape.effective_from,
});

export const PlanUpdate = PlanFields.partial();

/* ------------------------------------------------------------------ *
 * Lines and payouts
 * ------------------------------------------------------------------ */

export const ApproveLines = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Pick the commission to approve.').max(500),
});

export const PayoutCreate = z.object({
  member_id: z.string().uuid(),
  paid_on: dateOnly,
  /** AIT on commission, where the client withholds it */
  tax_pct: z.number().min(0).max(100).default(0),
  account_id: z.string().uuid().nullable().optional(),
  reference_no: text(120).optional(),
  notes: text(2000).optional(),
});

export const SoldByChange = z.object({
  sold_by_member_id: z.string().uuid().nullable(),
});
