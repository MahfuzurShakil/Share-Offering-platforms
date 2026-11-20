import { requireAnyPerm, requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import { deleteAccount, getAccount, updateAccount } from '@/server/services/money.service';
import { AccountUpdate } from '../schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  await requireAnyPerm(request, ['finance_expense', 'finance_collection'], 'view');
  const { id } = await params;
  return ok(await getAccount(id));
});

export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'finance_expense', 'edit');
  const { id } = await params;
  return ok(await updateAccount(id, await readJson(request, AccountUpdate)));
});

/** Only an account nothing has been paid out of; otherwise switch it off. */
export const DELETE = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'finance_expense', 'edit');
  const { id } = await params;
  await deleteAccount(id);
  return noContent();
});
