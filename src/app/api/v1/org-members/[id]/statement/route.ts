import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { memberStatement } from '@/server/services/commission.service';

type Context = { params: Promise<{ id: string }> };

/**
 * One member's commission statement (plan §7.3): each sale, its stages, what
 * is released, what is paid and what is still to come.
 *
 * One block per sale *per role*, because somebody can be the seller on one
 * purchase and the upline on another — adding those together would say they
 * earned twice on one sale.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'view');
  const { id } = await params;
  return ok(await memberStatement(id));
});
