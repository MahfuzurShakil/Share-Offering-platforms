import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createEntry, listEntries } from '@/server/services/revenue.service';
import { EntryBody } from '../schema';

type Context = { params: Promise<{ id: string }> };

const Query = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  direction: z.enum(['income', 'cost']).optional(),
  head: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(500).optional(),
});

export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'view');
  const { id } = await params;
  const q = readQuery(request, Query);
  const page = await listEntries(
    principal,
    id,
    { from: q.from, to: q.to, direction: q.direction, head: q.head },
    { page: q.page, page_size: q.page_size },
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

/** What the project earned or spent running it. Refused inside a closed period. */
export const POST = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'create');
  const { id } = await params;
  const input = await readJson(request, EntryBody);
  return created(await createEntry(principal, id, input));
});
