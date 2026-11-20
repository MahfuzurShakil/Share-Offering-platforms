import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { captureInquiry, findLeadByPhone, listLeads } from '@/server/services/lead.service';
import { LEAD_SOURCE, LEAD_STATUS, LeadCreate } from './schema';

const Query = z.object({
  search: z.string().max(200).optional(),
  status: z.enum([...LEAD_STATUS, 'all']).optional(),
  source: z.enum([...LEAD_SOURCE, 'all']).optional(),
  assigned_to: z.string().max(40).optional(),
  interested_project_id: z.string().uuid().optional(),
  follow_up: z.enum(['overdue', 'today', 'all']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'follow_up']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  /** the browser's clock, so "overdue" means overdue where the person is */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** ask instead whether this number already belongs to a lead */
  by_phone: z.string().max(40).optional(),
});

/**
 * The leads, or — with `by_phone` — the one that already has that number.
 *
 * The lookup shares this route because it is the same read: the form asks it
 * while somebody types, so a repeat caller is found before a second lead is
 * opened for them.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'crm', 'view');
  const q = readQuery(request, Query);

  if (q.by_phone) {
    return ok({ lead: await findLeadByPhone(q.by_phone) });
  }

  const page = await listLeads(
    {
      search: q.search,
      status: q.status,
      source: q.source,
      assigned_to: q.assigned_to,
      interested_project_id: q.interested_project_id,
      follow_up: q.follow_up,
    },
    { page: q.page, page_size: q.page_size, sort: q.sort },
    q.today,
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/**
 * A new inquiry. Answers 201 either way, with `merged` saying which happened:
 * a repeat caller's inquiry is added to their existing lead rather than
 * becoming a second row (Scope v3 §4.5).
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'crm', 'create');
  const input = await readJson(request, LeadCreate);
  return created(await captureInquiry(input));
});
