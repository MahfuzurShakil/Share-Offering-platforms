import { z } from 'zod';

/**
 * What may be sent about a purchase.
 *
 * None of the money is: the price per share comes from the round, the total
 * from the share count, the schedule from the plan, and how a payment is split
 * from what is owed. A caller sends decisions — how many shares, how much
 * down, how many installments, how much money arrived — and the server does
 * the arithmetic (PROJECT-SHARE-SALE-PLAN.md §7).
 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.');

export const ReserveBody = z.object({
  offering_id: z.string().uuid('Pick the round the shares come from.'),
  customer_id: z.string().uuid('Pick the investor.'),
  shares: z.number().int().positive('How many shares they are taking.'),
  down_payment_pct: z.number().min(0).max(100),
  installment_count: z.number().int().min(0).max(120),
  reserved_on: dateOnly.optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  sold_by_member_id: z.string().uuid().nullable().optional(),
});

export const SignBody = z.object({
  agreement_date: dateOnly,
  first_due_date: dateOnly.nullable().optional(),
  /** the plan as agreed at the table, when it differs from the reservation */
  terms: z
    .object({
      shares: z.number().int().positive(),
      down_payment_pct: z.number().min(0).max(100),
      installment_count: z.number().int().min(0).max(120),
    })
    .nullable()
    .optional(),
  /** place, witnesses, stamp and notary: the agreement's own facts */
  signing: z
    .object({
      place: z.string().trim().max(200).optional(),
      company_signatory: z.string().trim().max(200).optional(),
      company_signatory_title: z.string().trim().max(200).optional(),
      attorney_name: z.string().trim().max(200).optional(),
      witnesses: z
        .array(
          z.object({
            name: z.string().trim().max(200),
            id_or_phone: z.string().trim().max(60).optional(),
            address: z.string().trim().max(400).optional(),
          }),
        )
        .max(5)
        .optional(),
      stamp_value: z.number().min(0).optional(),
      stamp_serial: z.string().trim().max(80).optional(),
      notarized_on: dateOnly.optional(),
      notary_name: z.string().trim().max(200).optional(),
    })
    .nullable()
    .optional(),
});

export const StatusBody = z.object({
  status: z.enum(['released', 'cancelled']),
  note: z.string().trim().max(2000).default(''),
});

export const PaymentBody = z.object({
  paid_on: dateOnly,
  amount: z.number().positive('How much arrived.'),
  method: z.enum([
    'bank_transfer',
    'cheque',
    'cash',
    'bkash',
    'nagad',
    'card',
    'online',
    'profit_adjustment',
  ]),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  method_detail: z.string().trim().max(160).nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
});

export const ReverseBody = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Say why it is being reversed.').max(2000),
});
