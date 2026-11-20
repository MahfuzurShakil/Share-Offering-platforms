import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { markMemberLeft, rejoinMember } from '@/server/services/org.service';
import { MemberStatusChange } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Somebody leaves the sales team, or comes back.
 *
 * Leaving is refused while anybody still reports to them — the team has to be
 * moved first, so nobody is left reporting to somebody who is gone.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'approve');
  const { id } = await params;
  const body = await readJson(request, MemberStatusChange);
  return ok(
    body.status === 'left' ? await markMemberLeft(id, body.left_on!) : await rejoinMember(id),
  );
});
