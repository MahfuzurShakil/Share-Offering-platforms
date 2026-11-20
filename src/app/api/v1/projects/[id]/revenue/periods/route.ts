import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson } from '@/server/http/respond';
import { closePeriod, listPeriods } from '@/server/services/revenue.service';
import { ClosePeriodBody } from '../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Every period: the closed ones with their frozen statements, and the ones
 * still open, worked out live from the entries.
 */
export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok(await listPeriods(principal, id));
});

/** Closes a period: its entries are locked and its statement is frozen. */
export const POST = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'edit');
  const { id } = await params;
  const { period_start } = await readJson(request, ClosePeriodBody);
  return created(await closePeriod(principal, id, period_start));
});
