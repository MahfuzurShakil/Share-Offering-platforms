import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { openOffering } from '@/server/services/share-offering.service';
import { OpenBody } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Puts a draft on the market — its own endpoint, because it is the moment the
 * round becomes a promise to buyers and it carries the two dates that promise
 * is bounded by. `approve`, not `edit`: opening a round is the decision to
 * sell part of the project.
 */
export const POST = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'approve');
  const { id } = await params;
  const { opens_on, closes_on } = await readJson(request, OpenBody);
  return ok(await openOffering(principal, id, opens_on, closes_on));
});
