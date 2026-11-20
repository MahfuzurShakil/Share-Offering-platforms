import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { listSalesTeam } from '@/server/services/user.service';

/**
 * Who a lead can be assigned to — a picker, not the staff directory.
 *
 * Gated on the CRM view right rather than on user management: whoever can open
 * a lead has to be able to read the name in its "Assigned to" box.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'crm', 'view');
  return ok(await listSalesTeam());
});
