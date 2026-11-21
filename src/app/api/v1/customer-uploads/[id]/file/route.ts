import { NextResponse } from 'next/server';
import { requirePerm } from '@/server/auth/rbac';
import { handler } from '@/server/http/respond';
import { readUploadFile } from '@/server/services/inbox.service';

type Context = { params: Promise<{ id: string }> };

/**
 * The slip or the NID copy itself — bytes, not the envelope.
 *
 * Served through here for the same reason documents are: the storage key never
 * reaches a browser, so the permission is checked on every read and a link
 * cannot be passed to somebody who may not open the customer's file.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'share_sale', 'view');
  const { id } = await params;
  const file = await readUploadFile(id);

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      'content-type': file.mime,
      'content-length': String(file.bytes.byteLength),
      'content-disposition': `inline; filename="${file.name.replace(/[^\x20-\x7e]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      /* somebody's identity paper: never a shared cache */
      'cache-control': 'private, max-age=0, must-revalidate',
    },
  });
});
