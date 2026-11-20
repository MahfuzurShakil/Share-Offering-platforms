import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { assignLead } from '@/server/services/lead.service';
import { LeadAssignment } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Hands the lead to a Sales Executive, or takes it back.
 *
 * `approve`, not `edit`: assignment is a manager's job (Scope v3 §9.6), and an
 * executive who may work their own leads should not be able to take somebody
 * else's.
 */
export const PUT = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'approve');
  const { id } = await params;
  const { assigned_to } = await readJson(request, LeadAssignment);
  return ok(await assignLead(id, assigned_to));
});
