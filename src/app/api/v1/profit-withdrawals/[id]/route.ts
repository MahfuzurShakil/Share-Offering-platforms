import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import {
  approveWithdrawal,
  payWithdrawal,
  rejectWithdrawal,
} from '@/server/services/withdrawal.service';

type Context = { params: Promise<{ id: string }> };

const MoveBody = z.object({
  action: z.enum(['approve', 'reject', 'pay']),
  reason: z.string().trim().max(2000).optional(),
  paid_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.')
    .optional(),
  account_id: z.string().uuid().nullable().optional(),
  reference_no: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Deciding on a request, and recording the payout.
 *
 * All three are `finance_expense: approve` — money leaving the company is one
 * desk's call, whoever asked for it. The money stays held from the balance
 * from the moment it is asked for until it is paid or refused, so nobody can
 * ask for the same taka twice while the first request is being looked at.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_expense', 'approve');
  const { id } = await params;
  const body = await readJson(request, MoveBody);

  if (body.action === 'approve') return ok(await approveWithdrawal(principal, id));
  if (body.action === 'reject') return ok(await rejectWithdrawal(principal, id, body.reason ?? ''));
  return ok(
    await payWithdrawal(principal, id, {
      paid_on: body.paid_on ?? new Date().toISOString().slice(0, 10),
      account_id: body.account_id,
      reference_no: body.reference_no,
      notes: body.notes,
    }),
  );
});
