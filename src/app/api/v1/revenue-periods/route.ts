import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { listAllPeriods } from '@/server/services/revenue.service';

const Query = z.object({
  project_id: z.string().uuid().optional(),
  status: z.enum(['closed', 'approved', 'declared', 'cancelled']).optional(),
});

/** Every closed period across every project the caller may see. */
export const GET = handler(async (request) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const q = readQuery(request, Query);
  return ok(await listAllPeriods(principal, { project_id: q.project_id, status: q.status }));
});
