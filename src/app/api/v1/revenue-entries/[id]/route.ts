import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent } from '@/server/http/respond';
import { deleteEntry } from '@/server/services/revenue.service';

type Context = { params: Promise<{ id: string }> };

/** Removes an entry, while the period it falls in is still open. */
export const DELETE = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'edit');
  const { id } = await params;
  await deleteEntry(principal, id);
  return noContent();
});
