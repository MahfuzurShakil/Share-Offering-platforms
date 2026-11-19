import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import {
  cancelOffering,
  closeOffering,
  deleteOffering,
  getOffering,
  updateOffering,
} from '@/server/services/share-offering.service';
import { MoveBody, OfferingBody } from '../schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok(await getOffering(principal, id));
});

/**
 * Changes a draft, or makes the move that ends a round.
 *
 * Closing and cancelling arrive as a `status` on the same PATCH rather than as
 * two more endpoints: they take nothing but the id, and the service is what
 * decides whether the move is allowed from where the round is.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'edit');
  const { id } = await params;

  const body: unknown = await request.clone().json().catch(() => null);
  if (body && typeof body === 'object' && 'status' in body) {
    const { status } = await readJson(request, MoveBody);
    return ok(
      status === 'closed'
        ? await closeOffering(principal, id)
        : await cancelOffering(principal, id),
    );
  }

  const input = await readJson(request, OfferingBody);
  return ok(await updateOffering(principal, id, input));
});

/** Deletes a draft. A round that has been on the market is closed instead. */
export const DELETE = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'share_sale', 'edit');
  const { id } = await params;
  await deleteOffering(principal, id);
  return noContent();
});
