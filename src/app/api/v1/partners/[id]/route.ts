import { requireAnyPerm, requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import { deletePartner, getPartner, updatePartner } from '@/server/services/money.service';
import { PartnerUpdate } from '../../accounts/schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  await requireAnyPerm(request, ['finance_expense', 'sales_team'], 'view');
  const { id } = await params;
  return ok(await getPartner(id));
});

/**
 * `approve`, not `edit`: a percentage decides what somebody is paid out of
 * every future declaration, so moving one is an owner's decision rather than
 * a correction anybody can make. A changed share needs the day it takes
 * effect, and the old figure stays in the history.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'finance_expense', 'approve');
  const { id } = await params;
  return ok(await updatePartner(id, await readJson(request, PartnerUpdate)));
});

/** Only a partner never credited anything; otherwise switch them off. */
export const DELETE = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'finance_expense', 'approve');
  const { id } = await params;
  await deletePartner(id);
  return noContent();
});
