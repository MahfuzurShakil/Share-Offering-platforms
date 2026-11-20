import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { signAgreement } from '@/server/services/share-sale.service';
import { SignBody } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Signing the agreement — `approve`, not `edit`.
 *
 * It is the moment the shares stop being held and become sold, it fixes the
 * price and the schedule the customer will be held to, and it is what an
 * auditor asks about by name.
 */
export const POST = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'approve');
  const { id } = await params;
  const input = await readJson(request, SignBody);
  return ok(await signAgreement(principal, id, input));
});
