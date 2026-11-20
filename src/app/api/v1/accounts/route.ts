import { z } from 'zod';
import { requireAnyPerm, requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createAccount, listAccounts } from '@/server/services/money.service';
import { AccountCreate } from './schema';

const Query = z.object({
  is_active: z.enum(['true', 'false']).optional(),
});

/**
 * Where the company's money sits.
 *
 * Readable by either money desk, because both of them pick an account: one
 * receipts money in, the other pays it out. Only `finance_expense` may open a
 * new one.
 */
export const GET = handler(async (request) => {
  await requireAnyPerm(request, ['finance_expense', 'finance_collection'], 'view');
  const q = readQuery(request, Query);
  return ok(
    await listAccounts({ is_active: q.is_active === undefined ? undefined : q.is_active === 'true' }),
  );
});

export const POST = handler(async (request) => {
  await requirePerm(request, 'finance_expense', 'create');
  return created(await createAccount(await readJson(request, AccountCreate)));
});
