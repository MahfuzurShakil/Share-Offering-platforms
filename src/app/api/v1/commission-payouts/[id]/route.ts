import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { payoutDetail } from '@/server/services/commission.service';

type Context = { params: Promise<{ id: string }> };

/**
 * One payout: what it paid, and what it took back.
 *
 * Read-only, and there is no PATCH or DELETE here on purpose — a payout is the
 * record that money left, and the database itself refuses to change one. A
 * mistake is corrected by a further payout.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'view');
  const { id } = await params;
  return ok(await payoutDetail(id));
});
