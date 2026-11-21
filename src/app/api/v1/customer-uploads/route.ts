import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, handler, invalid, ok, readQuery } from '@/server/http/respond';
import { createUpload, listUploads } from '@/server/services/inbox.service';

const Query = z.object({
  status: z.enum(['under_review', 'accepted', 'rejected']).optional(),
  customer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid().optional(),
});

const KINDS = [
  'id_document',
  'photo',
  'tin',
  'address_proof',
  'nominee_id',
  'bank_proof',
  'signed_copy',
  'allotment_letter',
  'deed',
  'payment_proof',
  'pdc',
  'source_of_funds',
  'power_of_attorney',
  'other',
] as const;

/** The papers customers have sent in — the second inbox queue. */
export const GET = handler(async (request) => {
  await requirePerm(request, 'share_sale', 'view');
  return ok(await listUploads(readQuery(request, Query)));
});

/**
 * Putting a paper on a customer's record — `multipart/form-data`, like the
 * documents route, because it carries bytes.
 *
 * What the office uploads here is accepted as it lands; `source=customer` is
 * what the Customer Portal will send, and that waits for review.
 */
export const POST = handler(async (request) => {
  await requirePerm(request, 'share_sale', 'create');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw invalid('That upload did not arrive as a form.');
  }

  const parsed = z
    .object({
      customer_id: z.string().uuid(),
      sale_id: z.string().uuid().optional(),
      kind: z.enum(KINDS),
      title: z.string().trim().min(1).max(200),
      note: z.string().trim().max(2000).optional(),
      source: z.enum(['customer', 'office']).optional(),
    })
    .safeParse({
      customer_id: String(form.get('customer_id') ?? ''),
      ...(form.get('sale_id') ? { sale_id: String(form.get('sale_id')) } : {}),
      kind: String(form.get('kind') ?? ''),
      title: String(form.get('title') ?? ''),
      ...(form.get('note') ? { note: String(form.get('note')) } : {}),
      ...(form.get('source') ? { source: String(form.get('source')) } : {}),
    });
  if (!parsed.success) {
    const problems: Record<string, string> = {};
    for (const issue of parsed.error.issues) problems[issue.path.join('.') || '_'] ??= issue.message;
    throw invalid('Some of what was sent is not valid.', problems);
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw invalid('Choose a file to upload.', { file: 'Required.' });

  return created(
    await createUpload(
      { ...parsed.data, sale_id: parsed.data.sale_id ?? null },
      { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
    ),
  );
});
