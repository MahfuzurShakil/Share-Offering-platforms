import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { recordPayment, reversePayment } from '@/server/services/share-sale.service';
import { PaymentBody, ReverseBody } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Money received against this purchase.
 *
 * `finance_collection`, not `share_sale`: taking money is the accounts desk's
 * right, and the sales team who may sign an agreement are not the people who
 * may say a payment arrived.
 */
export const POST = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'create');
  const { id } = await params;
  const input = await readJson(request, PaymentBody);
  return ok(await recordPayment(principal, id, input));
});

/**
 * Corrects a receipt with its opposite. A receipt is never edited or deleted —
 * the database refuses both — so this writes the reversing entry.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'finance_collection', 'approve');
  const { id } = await params;
  const { payment_id, reason } = await readJson(request, ReverseBody);
  return ok(await reversePayment(principal, id, payment_id, reason));
});
