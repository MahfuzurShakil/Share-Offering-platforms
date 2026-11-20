import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson } from '@/server/http/respond';
import { getLead, logLeadActivity } from '@/server/services/lead.service';
import { LeadActivityCreate } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/** The follow-up log, oldest first — this is a conversation. */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'view');
  const { id } = await params;
  return ok((await getLead(id)).activities);
});

/** A call, a message, a visit. The newest date is the one the task list uses. */
export const POST = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'edit');
  const { id } = await params;
  return created(await logLeadActivity(id, await readJson(request, LeadActivityCreate)));
});
