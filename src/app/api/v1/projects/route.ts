import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createProject, listProjects } from '@/server/services/project.service';
import { ProjectCreate } from './schema';

const Query = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(['planning', 'design', 'approval', 'under_construction', 'nearly_complete', 'handover_ongoing', 'closed']).optional(),
  project_type: z.enum(['land_share', 'plot_development', 'apartment', 'commercial', 'mixed']).optional(),
  sales_status: z.enum(['not_open', 'open', 'paused', 'sold_out']).optional(),
  is_public: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'completion_soon', 'name']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
});

/** The project list. Paged, filtered and counted by the database. */
export const GET = handler(async (request) => {
  const principal = await requirePerm(request, 'project', 'view');
  const q = readQuery(request, Query);

  const page = await listProjects(
    principal,
    {
      search: q.search,
      status: q.status,
      project_type: q.project_type,
      sales_status: q.sales_status,
      is_public: q.is_public === undefined ? undefined : q.is_public === 'true',
    },
    { page: q.page, page_size: q.page_size, sort: q.sort },
  );

  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/** A new project. Its PRJ-YYYY-NNN code is allocated with the row. */
export const POST = handler(async (request) => {
  await requirePerm(request, 'project', 'create');
  const input = await readJson(request, ProjectCreate);
  return created(await createProject(input));
});
