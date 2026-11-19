import { z } from 'zod';

/**
 * What may be sent about a round of shares.
 *
 * A round is its premium, how many of the project's shares it offers, how long
 * it runs and the payment limits — nothing else. What the project is worth and
 * into how many shares it is cut are the project's own (its Valuation tab),
 * and the server copies them onto the round: accepting them from a caller
 * would let a round be sold at a price its project's valuation does not
 * support. Nor are `code`, `round_no`, `status` and `opens_on` sent, which the
 * round earns by being created and opened.
 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.');

export const OfferingBody = z
  .object({
    project_id: z.string().uuid('Pick the project whose shares are offered.'),
    premium_value: z.number().min(0).default(0),
    total_shares: z.number().int().positive('How many of the project’s shares this round offers.').max(10_000_000),
    /** either a window in days, or the day it closes */
    validity_days: z.number().int().min(1).max(365).optional(),
    closes_on: dateOnly.nullable().optional(),
    min_shares: z.number().int().min(1).default(1),
    max_shares: z.number().int().min(1),
    min_down_payment_pct: z.number().min(0).max(100).default(0),
    max_installments: z.number().int().min(0).max(120).default(0),
    installment_frequency: z.enum(['monthly', 'quarterly']).default('monthly'),
    late_fee_type: z.enum(['pct_once', 'fixed_once']).default('pct_once'),
    late_fee_pct: z.number().min(0).max(25).default(0),
    late_fee_amount: z.number().min(0).nullable().optional(),
    grace_days: z.number().int().min(0).max(90).default(0),
    hold_days: z.number().int().min(1).max(60).default(7),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => v.validity_days !== undefined || Boolean(v.closes_on), {
    message: 'Say how long the offer runs, or the day it closes.',
    path: ['validity_days'],
  });

export const OpenBody = z.object({
  opens_on: dateOnly.optional(),
  closes_on: dateOnly.optional(),
});

export const ExtendBody = z.object({
  extra_days: z.number().int().min(1).max(365),
});

export const MoveBody = z.object({
  /** `open` is its own endpoint, because it carries dates */
  status: z.enum(['closed', 'cancelled']),
});
