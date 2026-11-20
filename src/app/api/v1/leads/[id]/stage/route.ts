import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { completeLeadStage } from '@/server/services/lead.service';
import { LeadStageCompletion } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Completes the stage the lead is in: what happened in it goes into the log,
 * the lead's own record is brought up to date, and it moves on
 * (`domain/lead-stages.ts`).
 */
export const POST = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'edit');
  const { id } = await params;
  return ok(await completeLeadStage(id, await readJson(request, LeadStageCompletion)));
});
