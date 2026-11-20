import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { payableMembers, payoutPreview } from '@/server/services/commission.service';

const Query = z.object({
  /** ask instead what one member's payout would come to */
  member_id: z.string().uuid().optional(),
});

/**
 * Who has approved commission waiting, most owed first — or, with `member_id`,
 * exactly what that member's payout would come to.
 *
 * The preview is the same arithmetic the payout then runs, so what somebody
 * approves on screen is what leaves the account: the lines, the paid
 * commission on cancelled sales coming off first, and the tax on the rest.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'view');
  const { member_id } = readQuery(request, Query);
  if (member_id) return ok(await payoutPreview(member_id));
  return ok(await payableMembers());
});
