import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson } from '@/server/http/respond';
import { createPlan, listPlans } from '@/server/services/commission.service';
import { PlanCreate } from '../org-members/schema';

/**
 * The commission plans (plan §7.1): what is earned and in what stages.
 *
 * Each row carries how many lines came from it, because that is what decides
 * whether its terms may still be rewritten.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'view');
  return ok(await listPlans());
});

/**
 * A new plan. A draft may be half-finished; what goes `active` is checked
 * against `planProblem` in the shared domain — the same function the form
 * previews with — because from that moment it decides what people are owed.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'approve');
  return created(await createPlan(await readJson(request, PlanCreate)));
});
