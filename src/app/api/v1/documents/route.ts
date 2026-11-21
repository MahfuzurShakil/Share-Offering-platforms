import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { created, invalid, handler, ok, readQuery } from '@/server/http/respond';
import {
  DOCUMENT_ENTITY_TYPES,
  listDocuments,
  moduleForEntity,
  uploadDocument,
} from '@/server/services/document.service';

const Query = z.object({
  entity_type: z.enum(DOCUMENT_ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

/** One record's papers. The right needed is the owning record's own. */
export const GET = handler(async (request) => {
  const q = readQuery(request, Query);
  await requirePerm(request, moduleForEntity(q.entity_type), 'view');
  return ok(await listDocuments(q.entity_type, q.entity_id));
});

/**
 * Uploading one — `multipart/form-data`, the only place in this API that is
 * not JSON, because it carries bytes.
 *
 * The fields come in as form values, so they are strings: zod coerces the one
 * boolean and the service does the rest of the checking.
 */
export const POST = handler(async (request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw invalid('That upload did not arrive as a form.');
  }

  const parsed = Query.extend({
    document_type: z.string().min(1).max(64),
    custom_type_name: z.string().max(120).optional(),
    notes: z.string().max(2000).optional(),
    is_public: z.enum(['true', 'false']).optional(),
  }).safeParse({
    entity_type: String(form.get('entity_type') ?? ''),
    entity_id: String(form.get('entity_id') ?? ''),
    document_type: String(form.get('document_type') ?? ''),
    ...(form.get('custom_type_name') ? { custom_type_name: String(form.get('custom_type_name')) } : {}),
    ...(form.get('notes') ? { notes: String(form.get('notes')) } : {}),
    ...(form.get('is_public') ? { is_public: String(form.get('is_public')) } : {}),
  });
  if (!parsed.success) {
    const problems: Record<string, string> = {};
    for (const issue of parsed.error.issues) problems[issue.path.join('.') || '_'] ??= issue.message;
    throw invalid('Some of what was sent is not valid.', problems);
  }
  const fields = parsed.data;

  await requirePerm(request, moduleForEntity(fields.entity_type), 'create');

  const file = form.get('file');
  if (!(file instanceof File)) throw invalid('Choose a file to upload.', { file: 'Required.' });

  const bytes = Buffer.from(await file.arrayBuffer());
  return created(
    await uploadDocument(
      {
        entity_type: fields.entity_type,
        entity_id: fields.entity_id,
        document_type: fields.document_type,
        custom_type_name: fields.custom_type_name ?? null,
        notes: fields.notes ?? null,
        is_public: fields.is_public === 'true',
      },
      { name: file.name, type: file.type, bytes },
    ),
  );
});
