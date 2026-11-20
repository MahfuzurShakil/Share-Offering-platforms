import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import { deleteLead, getLead, updateLead } from '@/server/services/lead.service';
import { LeadUpdate } from '../schema';

type Context = { params: Promise<{ id: string }> };

/** The lead, its whole follow-up log, and what became of it. */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'view');
  const { id } = await params;
  return ok(await getLead(id));
});

export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'edit');
  const { id } = await params;
  return ok(await updateLead(id, await readJson(request, LeadUpdate)));
});

/** Only a lead that never became an investor; otherwise 409 with the reason. */
export const DELETE = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'edit');
  const { id } = await params;
  await deleteLead(id);
  return noContent();
});
