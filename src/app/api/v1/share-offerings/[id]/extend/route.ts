import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { extendOffering } from '@/server/services/share-offering.service';
import { ExtendBody } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/** Lets an open round run longer when its window ends with shares left. */
export const POST = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'approve');
  const { id } = await params;
  const { extra_days } = await readJson(request, ExtendBody);
  return ok(await extendOffering(principal, id, extra_days));
});
