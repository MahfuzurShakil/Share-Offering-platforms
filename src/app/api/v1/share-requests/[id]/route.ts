import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { moveRequest, reserveFromRequest } from '@/server/services/inbox.service';

type Context = { params: Promise<{ id: string }> };

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('contacted'),
    office_note: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({
    action: z.literal('declined'),
    office_note: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({ action: z.literal('reopen') }),
  z.object({
    action: z.literal('reserve'),
    /** needed when the request came from the website and has no customer yet */
    customer_id: z.string().uuid().optional(),
    /** the office may hold fewer than was asked for */
    shares: z.number().int().positive().optional(),
    down_payment_pct: z.number().min(0).max(100),
    installment_count: z.number().int().min(0).max(120),
    sold_by_member_id: z.string().uuid().nullable().optional(),
  }),
]);

/**
 * Working a request: a note, a decline, or the reservation it becomes.
 *
 * Reserving needs `approve` rather than `edit`: it takes shares off the market
 * for somebody, which is the same weight as signing — the other three are
 * notes about a conversation.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const { id } = await params;
  const body = await readJson(request, Body);

  if (body.action === 'reserve') {
    const principal = await requirePerm(request, 'share_sale', 'approve');
    return ok(await reserveFromRequest(principal, id, body));
  }

  const principal = await requirePerm(request, 'share_sale', 'edit');
  /* reopening clears the note rather than carrying the old decline's reason */
  const note = body.action === 'reopen' ? null : body.office_note;
  return ok(await moveRequest(principal, id, body.action, note));
});
