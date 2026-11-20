import { requireAnyPerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { listSalesTeam } from '@/server/services/user.service';

/**
 * The sales staff, as a picker — not the staff directory: a name and a role
 * code, nothing else.
 *
 * Two screens want it and they are behind different rights. Whoever can open a
 * lead has to be able to read the name in its "Assigned to" box, and whoever
 * builds the org chart has to be able to link a member to their login. Gating
 * it on user management would break both.
 */
export const GET = handler(async (request) => {
  await requireAnyPerm(request, ['crm', 'sales_team'], 'view');
  return ok(await listSalesTeam());
});
