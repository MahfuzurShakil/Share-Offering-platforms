import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { listSales, reserveShares } from '@/server/services/share-sale.service';
import { ReserveBody } from './schema';

const Query = z.object({
  offering_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  status: z.enum(['reserved', 'agreement_signed', 'fully_paid', 'released', 'cancelled']).optional(),
  search: z.string().max(200).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
});

/** The purchases, each with what its schedule says is paid, owed and overdue. */
export const GET = handler(async (request) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const q = readQuery(request, Query);

  const page = await listSales(
    principal,
    {
      offering_id: q.offering_id,
      project_id: q.project_id,
      customer_id: q.customer_id,
      status: q.status,
      search: q.search,
      overdue: q.overdue === 'true',
    },
    { page: q.page, page_size: q.page_size },
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/** Holds shares for an investor while the agreement is prepared. */
export const POST = handler(async (request) => {
  const principal = await requirePerm(request, 'share_sale', 'create');
  const input = await readJson(request, ReserveBody);
  return created(await reserveShares(principal, input));
});
