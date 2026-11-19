import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createOffering, listOfferings, roomOn } from '@/server/services/share-offering.service';
import { OfferingBody } from './schema';

const Query = z.object({
  project_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'open', 'closed', 'cancelled']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  /** ask instead how many of a project's shares are still free to offer */
  free_for_project: z.string().uuid().optional(),
  /** the round being edited, which does not count against its own project */
  except: z.string().uuid().optional(),
});

/**
 * The rounds, or — with `free_for_project` — how many of a project's shares
 * are still unoffered, which is what the form needs before it can let a number
 * of shares be typed. Both are reads of the same thing, so they share a route.
 */
export const GET = handler(async (request) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const q = readQuery(request, Query);

  if (q.free_for_project) {
    return ok(await roomOn(q.free_for_project, q.except));
  }

  const page = await listOfferings(
    principal,
    { project_id: q.project_id, status: q.status, search: q.search },
    { page: q.page, page_size: q.page_size },
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/** A new draft round. It reaches the market only when it is opened. */
export const POST = handler(async (request) => {
  const principal = await requirePerm(request, 'share_sale', 'create');
  const input = await readJson(request, OfferingBody);
  return created(await createOffering(principal, input));
});
