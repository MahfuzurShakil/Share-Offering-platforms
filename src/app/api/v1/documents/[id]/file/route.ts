import { NextResponse } from 'next/server';
import { requirePerm } from '@/server/auth/rbac';
import { handler } from '@/server/http/respond';
import {
  moduleForEntity,
  ownerOfDocument,
  readDocumentFile,
} from '@/server/services/document.service';

type Context = { params: Promise<{ id: string }> };

/**
 * The file itself — the one route in this API that answers with bytes rather
 * than the envelope.
 *
 * Files are served through here instead of from a public folder so that the
 * permission is checked on every read: a storage key never reaches a browser,
 * so a link cannot be passed around to somebody who may not open the record.
 * `Content-Disposition: inline` lets the viewer show a PDF or an image in
 * place; `nosniff` stops a browser deciding for itself that an upload is
 * something executable.
 */
export const GET = handler<Context>(async (request, { params }) => {
  const { id } = await params;
  const owner = await ownerOfDocument(id);
  await requirePerm(request, moduleForEntity(owner.entity_type), 'view');
  const file = await readDocumentFile(id);

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      'content-type': file.mime,
      'content-length': String(file.bytes.byteLength),
      'content-disposition': `inline; filename="${file.name.replace(/[^\x20-\x7e]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      /* a signed-in person's own paper: never a shared cache */
      'cache-control': 'private, max-age=0, must-revalidate',
    },
  });
});
