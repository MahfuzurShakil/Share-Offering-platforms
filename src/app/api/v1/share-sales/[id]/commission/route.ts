import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { linesForSale } from '@/server/services/commission.service';
import { setSoldBy } from '@/server/services/org.service';
import { SoldByChange } from '../../../org-members/schema';

type Context = { params: Promise<{ id: string }> };

/** What this purchase earns, and for whom — the seller first, then the uplines. */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'view');
  const { id } = await params;
  return ok(await linesForSale(id));
});

/**
 * Says who sold it, which is what starts the commission on a purchase.
 *
 * `share_sale: edit` rather than a sales-team right: this is a field of the
 * purchase, filled in by whoever is recording the sale. Once commission on it
 * has been earned the service refuses the change — those lines already belong
 * to somebody.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'edit');
  const { id } = await params;
  const { sold_by_member_id } = await readJson(request, SoldByChange);
  await setSoldBy(id, sold_by_member_id);
  return ok(await linesForSale(id));
});
