import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readQuery } from '@/server/http/respond';
import { followUpQueue } from '@/server/services/lead.service';

const Query = z.object({
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Who has to be called today, soonest first — the daily task list (§4.4). */
export const GET = handler(async (request) => {
  await requirePerm(request, 'crm', 'view');
  const { today } = readQuery(request, Query);
  return ok(await followUpQueue(today));
});
