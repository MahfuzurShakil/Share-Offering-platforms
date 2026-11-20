import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { capTable } from '@/server/services/money.service';

type Context = { params: Promise<{ id: string }> };

const Query = z.object({
  /** read it as it stood on a day; today by default */
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Who owns this project, always adding to 100% (REVENUE-SHARE-PLAN.md §4).
 *
 * The customers by what they bought, then the owners' part split by partner.
 * Gated on the share-sale view right rather than a money one: it is the same
 * question the project's own screens ask, and a declaration reads exactly this
 * on its record date.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  const { as_of } = readQuery(request, Query);
  return ok(await capTable(id, as_of));
});
