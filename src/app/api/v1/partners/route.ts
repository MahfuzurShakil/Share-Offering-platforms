import { z } from 'zod';
import { requireAnyPerm, requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createPartner, listPartners } from '@/server/services/money.service';
import { PartnerCreate } from '../accounts/schema';

const Query = z.object({
  is_active: z.enum(['true', 'false']).optional(),
  project_id: z.string().uuid().optional(),
  /** only the partners of the whole company, not one project's investors */
  company_only: z.enum(['true', 'false']).optional(),
});

/**
 * Who owns the company, or one project of it.
 *
 * Readable by the sales-team desk as well: a founder who also owns part of the
 * company is one row in the org chart and one here, and the member form has to
 * be able to offer the link.
 */
export const GET = handler(async (request) => {
  await requireAnyPerm(request, ['finance_expense', 'sales_team'], 'view');
  const q = readQuery(request, Query);
  return ok(
    await listPartners({
      is_active: q.is_active === undefined ? undefined : q.is_active === 'true',
      project_id: q.project_id,
      company_only: q.company_only === 'true',
    }),
  );
});

/**
 * A new partner. Their opening percentage goes into the history as well, from
 * the day they came in — so a declaration dated before their first change has
 * something on file to read rather than falling back to today's figure.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'finance_expense', 'approve');
  return created(await createPartner(await readJson(request, PartnerCreate)));
});
