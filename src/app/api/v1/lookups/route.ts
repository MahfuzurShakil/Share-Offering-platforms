import { z } from 'zod';
import { requireStaff } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { listLookups } from '@/server/services/lookup.service';

const Query = z.object({
  category: z.string().min(1).max(64),
  scope: z.string().max(64).optional(),
  /** include the ones switched off, for a form showing a value already stored */
  include_inactive: z.enum(['true', 'false']).optional(),
});

/**
 * The option lists the client edits themselves — designations, income and
 * expense heads, document types, amenities (AGENTS.md).
 *
 * Gated on being signed-in staff rather than on a module right, because this
 * is what fills the pickers *inside* other modules: the org chart needs the
 * designations, and whoever may open the org chart is not necessarily allowed
 * into Master Data. There is nothing here but labels and their order.
 *
 * Only the categories the software actually uses are served. An open
 * `category` would let a caller fish for whatever else lands in this table.
 */
export const GET = handler(async (request) => {
  await requireStaff(request);
  const q = readQuery(request, Query);
  return ok(
    await listLookups(q.category, q.scope ?? null, { includeInactive: q.include_inactive === 'true' }),
  );
});
