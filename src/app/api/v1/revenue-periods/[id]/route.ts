import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import {
  approvePeriod,
  declarePeriod,
  periodDetail,
  reopenPeriod,
  unapprovePeriod,
} from '@/server/services/revenue.service';
import { PeriodMoveBody } from '../../projects/[id]/revenue/schema';

type Context = { params: Promise<{ id: string }> };

/**
 * One period, whole: its frozen statement, what each head contributed, and who
 * got what — or, before it is declared, who *would*.
 *
 * One read rather than four, because the page shows all of it at once and a
 * preview assembled from separate calls can disagree with itself.
 */
export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok(await periodDetail(principal, id));
});

/**
 * Approving, declaring, or opening a period again.
 *
 * All three take `approve` on the money module: how much is shared, and the
 * moment it stops being changeable, is management's call. Declaring is the
 * point of no return — the record date is fixed and every holder's share is
 * frozen, and a mistake after it is corrected in the next period.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'approve');
  const { id } = await params;
  const body = await readJson(request, PeriodMoveBody);

  if (body.action === 'reopen') {
    await reopenPeriod(principal, id);
    return noContent();
  }
  if (body.action === 'unapprove') return ok(await unapprovePeriod(principal, id));
  if (body.action === 'approve') {
    return ok(await approvePeriod(principal, id, body.declared ?? 0));
  }
  return ok(await declarePeriod(principal, id, body.record_date));
});
