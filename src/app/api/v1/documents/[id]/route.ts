import { z } from 'zod';
import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import {
  deleteDocument,
  moduleForEntity,
  ownerOfDocument,
  setDocumentPublic,
} from '@/server/services/document.service';

type Context = { params: Promise<{ id: string }> };

const PatchBody = z.object({ is_public: z.boolean() });

/**
 * Putting a file on the website, or taking it off.
 *
 * The right is the owning record's, which has to be looked up first — the id
 * in the URL says nothing about whose paper it is.
 */
export const PATCH = handler<Context>(async (request, { params }) => {
  const { id } = await params;
  const owner = await ownerOfDocument(id);
  await requirePerm(request, moduleForEntity(owner.entity_type), 'edit');
  const body = await readJson(request, PatchBody);
  return ok(await setDocumentPublic(id, body.is_public));
});

export const DELETE = handler<Context>(async (request, { params }) => {
  const { id } = await params;
  const owner = await ownerOfDocument(id);
  await requirePerm(request, moduleForEntity(owner.entity_type), 'edit');
  await deleteDocument(id);
  return noContent();
});
