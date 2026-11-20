import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { customerEarnings } from '@/server/services/revenue.service';

type Context = { params: Promise<{ id: string }> };

/** What this investor has been credited, period by period. */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok(await customerEarnings(id));
});
