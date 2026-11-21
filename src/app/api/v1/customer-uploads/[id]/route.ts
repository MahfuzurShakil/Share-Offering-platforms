import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { reviewUpload } from '@/server/services/inbox.service';

type Context = { params: Promise<{ id: string }> };

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({
    action: z.literal('reject'),
    review_note: z.string().trim().min(1, 'Say what to send instead.').max(2000),
  }),
]);

/**
 * Accepting a paper, or sending it back.
 *
 * `edit` on the share-sale module: it is the customer's file being kept in
 * order. The reason on a rejection is read by the customer, which is why the
 * schema insists on one.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'edit');
  const { id } = await params;
  const body = await readJson(request, Body);
  return ok(
    await reviewUpload(id, body.action, body.action === 'reject' ? body.review_note : null),
  );
});
