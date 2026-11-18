import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { listAssignableManagers } from '@/server/services/user.service';

/**
 * The people a project can be assigned to — a picker, not the staff directory.
 *
 * Gated on the project view right rather than on user management: whoever can
 * open the project form has to be able to fill its manager field, and what
 * comes back is a name and a role code, which the project screens already show.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'project', 'view');
  return ok(await listAssignableManagers());
});
