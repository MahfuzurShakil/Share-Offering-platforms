import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import { deletePlan, getPlan, updatePlan } from '@/server/services/commission.service';
import { PlanUpdate } from '../../org-members/schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'view');
  const { id } = await params;
  return ok(await getPlan(id));
});

/**
 * Changes a plan. Its terms are only rewritable while nothing has earned
 * against it; after that the service refuses with the count, and retiring it
 * and writing a new one is the way to change the rates.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'approve');
  const { id } = await params;
  return ok(await updatePlan(id, await readJson(request, PlanUpdate)));
});

export const DELETE = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'approve');
  const { id } = await params;
  await deletePlan(id);
  return noContent();
});
