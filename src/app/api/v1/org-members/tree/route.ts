import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { orgTree } from '@/server/services/org.service';

/**
 * The org chart: the tree, with each branch's team size and what it has sold.
 *
 * Built in one pass over one read of the members and one grouped read of the
 * sales, rather than a query per node — a hundred-person organisation is one
 * screen, not a hundred requests.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'view');
  return ok(await orgTree());
});
