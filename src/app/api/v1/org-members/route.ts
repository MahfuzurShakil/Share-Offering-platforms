import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createMember, listMembers } from '@/server/services/org.service';
import { MemberCreate } from './schema';

const Query = z.object({
  designation_id: z.string().uuid().optional(),
  status: z.enum(['active', 'left', 'all']).optional(),
  search: z.string().max(200).optional(),
});

/**
 * The sales organisation, as a flat list — name, designation, who they report
 * to, and what they and their branch have sold.
 *
 * The tree is its own endpoint: the list is what a table and a picker want,
 * and the chart wants the shape.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'view');
  const q = readQuery(request, Query);
  return ok(
    await listMembers({
      designation_id: q.designation_id,
      status: q.status,
      search: q.search,
    }),
  );
});

export const POST = handler(async (request) => {
  await requirePerm(request, 'sales_team', 'create');
  return created(await createMember(await readJson(request, MemberCreate)));
});
