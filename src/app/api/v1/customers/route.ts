import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import {
  createCustomer,
  findByPhone,
  listCustomers,
} from '@/server/services/customer.service';
import { CustomerCreate } from './schema';

const Query = z.object({
  name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  nid: z.string().max(40).optional(),
  profession: z.string().max(120).optional(),
  holding_state: z.enum(['any', 'none', 'active', 'signed']).optional(),
  sort: z.enum(['newest', 'oldest', 'name']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(200).optional(),
  /** ask instead whether this number is already on file */
  by_phone: z.string().max(40).optional(),
});

/**
 * The investors, or — with `by_phone` — the one who already has that number.
 *
 * The lookup shares this route because it is the same read: the form asks it
 * while somebody types, so a person already on file is found before a second
 * record is made for them.
 */
export const GET = handler(async (request) => {
  await requirePerm(request, 'share_sale', 'view');
  const q = readQuery(request, Query);

  if (q.by_phone) {
    return ok({ customer: await findByPhone(q.by_phone) });
  }

  const page = await listCustomers(
    {
      name: q.name,
      phone: q.phone,
      nid: q.nid,
      profession: q.profession,
      holding_state: q.holding_state,
    },
    { page: q.page, page_size: q.page_size, sort: q.sort },
  );
  return ok(page.rows, { page: page.page, page_size: page.page_size, total: page.total });
});

export const POST = handler(async (request) => {
  await requirePerm(request, 'share_sale', 'create');
  const input = await readJson(request, CustomerCreate);
  return created(await createCustomer(input));
});
