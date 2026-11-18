import { allows } from '@/lib/domain/permissions';
import { AuthError, levelFor, requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { setSalesStatus } from '@/server/services/project.service';
import { SalesStatusBody } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Opening, pausing and closing sales — its own endpoint, not a field on PATCH.
 *
 * It is a move with rules about where it can go from, and it is what somebody
 * will later ask the audit log about by name.
 *
 * Who may: whoever can edit the project, **or** whoever can edit share sale —
 * opening a project for selling is the sales team's call as much as the
 * project owner's, which is what the detail screen already showed. Two modules
 * either of which is enough is not something `requirePerm` can express, so the
 * floor is the project view right and the second right is checked here.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'project', 'view');
  const mayProject = allows(principal.level, 'edit');
  const maySell = allows(await levelFor(principal.role, 'share_sale'), 'edit');
  if (!mayProject && !maySell) {
    throw new AuthError(403, 'forbidden', 'Your role does not allow opening or pausing sales.');
  }

  const { id } = await params;
  const { sales_status } = await readJson(request, SalesStatusBody);
  return ok(await setSalesStatus(principal, id, sales_status));
});
