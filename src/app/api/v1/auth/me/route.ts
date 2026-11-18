import { levelFor } from '@/server/auth/rbac';
import { requireAuth } from '@/server/auth/rbac';
import { PERMISSION_MODULES } from '@/lib/domain/permissions';
import { handler, ok } from '@/server/http/respond';

/**
 * Who am I, and what may I do.
 *
 * The browser calls this once on load: it is where the UI learns which menu
 * items to draw. The levels are the same rows the server checks on every
 * request, so the menu and the boundary cannot disagree.
 */
export const GET = handler(async (request) => {
  const principal = await requireAuth(request);

  if (principal.kind === 'customer') {
    return ok({ kind: 'customer', customer_id: principal.customer_id });
  }

  const entries = await Promise.all(
    PERMISSION_MODULES.map(async (module) => [module, await levelFor(principal.role, module)] as const),
  );

  return ok({
    kind: 'staff',
    user: { id: principal.user_id, name: principal.name, role: principal.role },
    project_ids: principal.project_ids,
    permissions: Object.fromEntries(entries),
  });
});
