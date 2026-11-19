import { z } from 'zod';

/**
 * What may be sent about a customer.
 *
 * Everything but the name and the phone is optional, and stays optional: the
 * office meets an investor before it has their e-TIN or their nominee's NID,
 * and a form that refuses to save until every KYC field is filled in is a form
 * people work around. What is required to *sign an agreement* is a different
 * question, asked at the signing (PROJECT-SHARE-SALE-PLAN.md §4a).
 *
 * Not here: `code` (the series gives it), `customer_type` (every customer in
 * this product is an investor), and the portal password.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 1985-04-01.')
  .nullable();

const text = (max: number) => z.string().trim().max(max).nullable();

export const CustomerFields = z.object({
  name: z.string().trim().min(2, 'Who is this?').max(200),
  phone: z.string().trim().min(6, 'Eleven digits, starting 01.').max(20),
  email: z.string().trim().email('That email does not look right.').max(200).nullable(),
  lead_id: z.string().uuid().nullable(),

  /** KYC as the agreement names a person */
  nid: text(40),
  tin: text(40),
  date_of_birth: dateOnly,
  father_or_spouse_name: text(200),
  profession: text(120),
  address: text(2000),
  permanent_address: text(2000),
  kyc_verified_on: dateOnly,

  nominee_name: text(200),
  nominee_relation: text(80),
  nominee_phone: text(20),
  nominee_nid: text(40),

  bank_name: text(160),
  bank_branch: text(160),
  bank_account: text(60),
});

export const CustomerCreate = CustomerFields.partial().extend({
  name: CustomerFields.shape.name,
  phone: CustomerFields.shape.phone,
});

export const CustomerUpdate = CustomerFields.partial();
