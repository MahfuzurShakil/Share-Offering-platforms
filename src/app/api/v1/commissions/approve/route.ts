import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { approveLines } from '@/server/services/commission.service';
import { ApproveLines } from '../../org-members/schema';

/**
 * Accounts accepts earned commission, singly or in bulk — it becomes payable
 * (plan §7.2 step 3).
 *
 * Only `earned` lines are taken; a `pending` one is quietly skipped rather
 * than approved, because approving a stage the ledger has not reached would
 * promise money on a payment nobody has made.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'approve');
  const { ids } = await readJson(request, ApproveLines);
  return ok(await approveLines(ids));
});
