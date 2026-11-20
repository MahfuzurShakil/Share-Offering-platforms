import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { getPolicy, savePolicy } from '@/server/services/revenue.service';
import { PolicyBody } from './schema';

type Context = { params: Promise<{ id: string }> };

/** How this project shares its profit, or null when it shares none. */
export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok({ policy: await getPolicy(principal, id) });
});

/**
 * Turns profit sharing on, or changes the rules.
 *
 * `approve`: the reserve, the management fee and the withheld tax are what
 * every holder's share is worked out from, so setting them is a management
 * decision rather than data entry.
 */
export const PUT = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'approve');
  const { id } = await params;
  const input = await readJson(request, PolicyBody);
  return ok(await savePolicy(principal, id, input));
});
