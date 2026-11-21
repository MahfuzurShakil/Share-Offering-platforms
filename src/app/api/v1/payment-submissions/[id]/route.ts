import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { confirmSubmission, rejectSubmission } from '@/server/services/inbox.service';

type Context = { params: Promise<{ id: string }> };

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('confirm'),
    /** Accounts may correct both against the statement */
    amount: z.number().positive().optional(),
    paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    account_id: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({
    action: z.literal('reject'),
    review_note: z.string().trim().min(1, 'Say why, for the customer.').max(2000),
  }),
]);

/**
 * Confirming a slip against the bank statement, or sending it back.
 *
 * Both are `finance_collection: approve`: confirming writes a receipt, and
 * refusing one tells a customer their money has not been seen. Neither is a
 * clerical act.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'approve');
  const { id } = await params;
  const body = await readJson(request, Body);

  if (body.action === 'confirm') {
    return ok(await confirmSubmission(principal, id, body));
  }
  return ok(await rejectSubmission(principal, id, body.review_note));
});
