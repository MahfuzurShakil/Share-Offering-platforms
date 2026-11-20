import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { cancelSale, releaseSale } from '@/server/services/share-sale.service';
import { StatusBody } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Releasing a hold, or cancelling a signed purchase.
 *
 * Releasing is ordinary work — a hold lapses, the customer changed their mind.
 * Cancelling ends an agreement somebody signed, so it needs `approve` and a
 * reason, which the service refuses to do without.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const { id } = await params;
  const { status, note } = await readJson(request, StatusBody);

  if (status === 'released') {
    const principal = await requirePerm(request, 'share_sale', 'edit');
    return ok(await releaseSale(principal, id, note));
  }
  const principal = await requirePerm(request, 'share_sale', 'approve');
  return ok(await cancelSale(principal, id, note));
});
