import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { balancesFor, listWithdrawals, requestWithdrawal } from '@/server/services/withdrawal.service';

const Query = z.object({
  project_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  status: z.enum(['requested', 'approved', 'paid', 'rejected']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  /** ask instead what one investor has to withdraw, project by project */
  balances_for: z.string().uuid().optional(),
});

const RequestBody = z.object({
  project_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  amount: z.number().positive('How much they are taking.'),
  method: z.enum(['bank_transfer', 'bkash', 'nagad', 'cheque', 'cash']),
  pay_to: z.string().trim().min(3, 'Where the money should go.').max(200),
});

/** The payout requests, or — with `balances_for` — what somebody could ask for. */
export const GET = handler(async (request) => {
  const principal = await requirePerm(request, 'finance_expense', 'view');
  const q = readQuery(request, Query);

  if (q.balances_for) {
    return ok({ balances: await balancesFor(q.balances_for) });
  }

  const page = await listWithdrawals(
    principal,
    { project_id: q.project_id, customer_id: q.customer_id, status: q.status },
    { page: q.page, page_size: q.page_size },
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/**
 * Asks for part of a balance.
 *
 * The office records one on an investor's behalf; the Customer Portal will
 * post the same thing with `channel: portal` when it moves.
 */
export const POST = handler(async (request) => {
  const principal = await requirePerm(request, 'finance_expense', 'create');
  const input = await readJson(request, RequestBody);
  return created(await requestWithdrawal(principal, input));
});
