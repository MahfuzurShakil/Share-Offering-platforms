import { requireAnyPerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { partnerHistory } from '@/server/services/money.service';

type Context = { params: Promise<{ id: string }> };

/**
 * How this partner's share has moved, and from when — newest first.
 *
 * It is what makes an old declaration readable: the split is taken on the
 * record date, so a percentage changed in October must not re-split a period
 * declared in June.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requireAnyPerm(request, ['finance_expense', 'sales_team'], 'view');
  const { id } = await params;
  return ok(await partnerHistory(id));
});
