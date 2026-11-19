import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import {
  deleteCustomer,
  getCustomer,
  updateCustomer,
} from '@/server/services/customer.service';
import { CustomerUpdate } from '../schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  return ok(await getCustomer(id));
});

export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'edit');
  const { id } = await params;
  const input = await readJson(request, CustomerUpdate);
  return ok(await updateCustomer(id, input));
});

/** Only somebody who has bought nothing; otherwise 409 with the reason. */
export const DELETE = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'edit');
  const { id } = await params;
  await deleteCustomer(id);
  return noContent();
});
