import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { leadSummary } from '@/server/services/lead.service';

const Query = z.object({
  /** the browser's clock, so "due today" means today where the person is */
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * What the sales desk owes today, and how the pipeline is spread.
 *
 * Its own endpoint rather than a count the list adds up: the banner above the
 * list and the dashboard both show it, and both have to say the same number.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'crm', 'view');
  const { today } = readQuery(request, Query);
  return ok(await leadSummary(today));
});
