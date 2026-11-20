import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { setLeadStatus } from '@/server/services/lead.service';
import { LeadStatusChange } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Marks a lead lost, or revives it to an earlier stage. The move is logged, so
 * the record never changes silently (Scope v3 §4.6).
 */
export const POST = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'edit');
  const { id } = await params;
  const input = await readJson(request, LeadStatusChange);
  return ok(
    await setLeadStatus(id, input.status, {
      notes: input.notes,
      next_follow_up_date: input.next_follow_up_date,
    }),
  );
});
