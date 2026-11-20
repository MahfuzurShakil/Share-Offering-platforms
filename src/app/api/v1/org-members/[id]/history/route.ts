import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { memberHistory } from '@/server/services/org.service';

type Context = { params: Promise<{ id: string }> };

/**
 * Who this member reported to, and from when — newest first.
 *
 * Not a nicety: it is what makes a past commission readable. Reading today's
 * tree instead would move an old sale's override to whoever the seller reports
 * to now.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'view');
  const { id } = await params;
  return ok(await memberHistory(id));
});
