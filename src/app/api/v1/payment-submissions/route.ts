import { z } from 'zod';
import { requireAnyPerm, requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import {
  createSubmission,
  inboxCounts,
  listSubmissions,
} from '@/server/services/inbox.service';

const Query = z.object({
  status: z.enum(['submitted', 'confirmed', 'rejected', 'withdrawn']).optional(),
  customer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid().optional(),
  /** the four numbers across the top of the inbox screen, instead of the rows */
  counts: z.enum(['true', 'false']).optional(),
});

/**
 * What customers say they have paid — the third queue, and the only one that
 * turns into money.
 *
 * Readable by either money desk and by the share-sale desk: the person who
 * confirms it is in Accounts, and the person chasing a purchase needs to know
 * a slip is already sitting here before they call the investor.
 */
export const GET = handler(async (request) => {
  const principal = await requireAnyPerm(
    request,
    ['finance_collection', 'share_sale'],
    'view',
  );
  const q = readQuery(request, Query);
  if (q.counts === 'true') return ok(await inboxCounts(principal));
  return ok(await listSubmissions(principal, q));
});

const Body = z.object({
  customer_id: z.string().uuid(),
  sale_id: z.string().uuid(),
  amount: z.number().positive('How much was paid.'),
  method: z.enum(['bank_deposit', 'bank_transfer', 'cheque_deposit', 'pay_order']),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'The date on the slip.'),
  reference: z.string().trim().min(1, 'The slip or transaction number.').max(120),
  paid_into_account_id: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  slip_upload_id: z.string().uuid().nullable().optional(),
});

/**
 * Recording that a customer says money went in. Nothing is paid by this.
 *
 * `finance_collection: create` while the office is the only caller — somebody
 * ringing in to say they deposited at the bank. The Customer Portal posts here
 * as the customer when it moves, and the customer id then comes from the
 * session rather than the body.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'finance_collection', 'create');
  const body = await readJson(request, Body);
  return created(await createSubmission(body.customer_id, body));
});
