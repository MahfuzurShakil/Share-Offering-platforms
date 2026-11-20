import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { getSale } from '@/server/services/share-sale.service';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok(await getSale(principal, id));
});
