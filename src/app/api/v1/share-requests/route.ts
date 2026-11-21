import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, ok, readJson, readQuery } from '@/server/http/respond';
import { createRequest, listRequests } from '@/server/services/inbox.service';

const Query = z.object({
  status: z.enum(['new', 'contacted', 'reserved', 'declined', 'withdrawn']).optional(),
  offering_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
});

/** The requests waiting to be worked: the first of the three inbox queues. */
export const GET = handler(async (request) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  return ok(await listRequests(principal, readQuery(request, Query)));
});

const Body = z.object({
  offering_id: z.string().uuid(),
  customer_id: z.string().uuid().nullable().optional(),
  prospect_name: z.string().trim().max(200).nullable().optional(),
  prospect_phone: z.string().trim().max(20).nullable().optional(),
  prospect_email: z.string().trim().max(200).nullable().optional(),
  shares: z.number().int().positive('How many shares.'),
  installments: z.number().int().min(0).max(120).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  source: z.enum(['portal', 'website']).optional(),
});

/**
 * Taking a request in.
 *
 * On `share_sale: create` for now, because the only caller is the office
 * entering one that came in by phone. When the Customer Portal and the public
 * `/invest` page move, they post here as the customer or as nobody — and that
 * is the point at which this route grows its own gate, not before.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'share_sale', 'create');
  return created(await createRequest(await readJson(request, Body)));
});
