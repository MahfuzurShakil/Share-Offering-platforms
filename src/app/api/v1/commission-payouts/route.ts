import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { listPayouts, payCommission } from '@/server/services/commission.service';
import { PayoutCreate } from '../org-members/schema';

const Query = z.object({
  member_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
});

export const GET = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'view');
  const q = readQuery(request, Query);
  const page = await listPayouts(
    { member_id: q.member_id },
    { page: q.page, page_size: q.page_size },
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/**
 * Pays a member all their approved commission at once (plan §7.2 step 4).
 *
 * `finance_expense`, not `sales_team`: this is money leaving the company, and
 * that is one desk's call whoever the commission belongs to — the same rule
 * the profit withdrawals follow.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'finance_expense', 'approve');
  return created(await payCommission(await readJson(request, PayoutCreate)));
});
