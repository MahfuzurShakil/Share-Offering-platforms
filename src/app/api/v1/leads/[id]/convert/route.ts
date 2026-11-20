import { requirePerm } from '@/server/auth/rbac';
import { handler, ok, readJson } from '@/server/http/respond';
import { convertLeadToCustomer } from '@/server/services/lead.service';
import { LeadConversion } from '../../schema';

type Context = { params: Promise<{ id: string }> };

/**
 * Makes the investor from the lead — the hand-over between the two halves of
 * the journey (SALES-FLOW-PLAN.md).
 *
 * Both rights are asked for, because it writes on both sides: it opens an
 * investor file, which is a share-sale record, from a CRM one. Somebody whose
 * number is already on file is linked rather than duplicated, and the answer
 * says which of the two happened.
 */
export const POST = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'crm', 'edit');
  await requirePerm(request, 'share_sale', 'create');
  const { id } = await params;
  return ok(await convertLeadToCustomer(id, await readJson(request, LeadConversion)));
});
