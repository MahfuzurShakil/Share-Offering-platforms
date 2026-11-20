import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { moveMember } from '@/server/services/org.service';
import { MemberMove } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Puts a member under somebody else from a date. Their whole team goes with
 * them, and the old place is written down.
 *
 * `approve`, not `edit`: who reports to whom decides who earns an override on
 * every future sale, so it is a manager's call rather than a correction
 * anybody can make.
 */
export const POST = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'approve');
  const { id } = await params;
  return ok(await moveMember(id, await readJson(request, MemberMove)));
});
