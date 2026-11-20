import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { listLines } from '@/server/services/commission.service';

const Query = z.object({
  member_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  share_sale_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'earned', 'approved', 'paid', 'void', 'recovered']).optional(),
  role: z.enum(['seller', 'override']).optional(),
  /** this member and everybody under them — a lead looking at their branch */
  team_of: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(500).optional(),
});

/**
 * The commission lines: by member, project, sale, stage and status, with the
 * totals over everything the filters match.
 *
 * Reading this reconciles the lines with the ledgers first, which is how a
 * stage is released "automatically" (plan §7.2) without a background job: the
 * reconciliation is idempotent, so it is cheaper to be right on every read
 * than to keep a job honest.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'view');
  const q = readQuery(request, Query);

  const page = await listLines(
    {
      member_id: q.member_id,
      project_id: q.project_id,
      share_sale_id: q.share_sale_id,
      status: q.status,
      role: q.role,
      team_of: q.team_of,
    },
    { page: q.page, page_size: q.page_size },
  );
  return ok(
    { rows: page.rows, totals: page.totals },
    { page: page.page, page_size: page.page_size, total: page.total },
  );
});
