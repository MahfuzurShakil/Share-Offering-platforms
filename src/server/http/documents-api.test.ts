import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listDocuments, POST as uploadDocument } from '@/app/api/v1/documents/route';
import {
  DELETE as deleteDocument,
  PATCH as patchDocument,
} from '@/app/api/v1/documents/[id]/route';
import { GET as getFile } from '@/app/api/v1/documents/[id]/file/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * Documents end to end: the bytes go to the store, the row goes to Postgres,
 * and the two are read back together.
 *
 * What is really being tested is the boundary this module exists to hold. A
 * document's permission is its *owning record's*, so a clerk who may only
 * read projects must not be able to attach one; the storage key must never
 * leave the server, because a key that reaches a browser is a file anybody can
 * fetch; and deleting a document has to take the file with it, since a hidden
 * row whose bytes are still on the disk is what a client gets asked about.
 */

const suite = hasTestDb ? describe : describe.skip;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

function req(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  init: { body?: unknown; form?: FormData; token?: string } = {},
) {
  const headers = new Headers();
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

suite('documents API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let viewerToken: string;
  let projectId: string;
  let customerId: string;

  beforeAll(() => {
    /* the files go to a throwaway folder, never the developer's own store */
    process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'sharesale-docs-'));
  });

  async function signIn(identifier: string): Promise<string> {
    const response = await login(
      req('POST', '/api/v1/auth/login', { body: { identifier, password: 'nokshi-green-2026' } }),
      undefined,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: { token: string } }).data.token;
  }

  beforeEach(async () => {
    db ??= testDb();
    hash ||= await hashPassword('nokshi-green-2026');
    await resetDb(db);
    clearPermissionCache();

    await db.role.create({
      data: {
        code: 'super_admin',
        name: 'Super Admin',
        permissions: {
          create: [
            { module: 'project', level: 'full' },
            { module: 'share_sale', level: 'full' },
          ],
        },
      },
    });
    await db.role.create({
      data: {
        code: 'accounts',
        name: 'Accounts',
        permissions: { create: [{ module: 'project', level: 'view' }] },
      },
    });
    await db.user.create({
      data: { name: 'Owner', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    await db.user.create({
      data: { name: 'Clerk', phone: '01711000002', password_hash: hash, role_code: 'accounts' },
    });
    token = await signIn('01711000001');
    viewerToken = await signIn('01711000002');

    const project = await db.project.create({
      data: { code: 'PRJ-2026-001', name: 'Green Court' },
    });
    projectId = project.id;
    const customer = await db.customer.create({
      data: { code: 'CUST-2026-001', name: 'Rahim Uddin', phone: '01811000001' },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  function upload(
    fields: Record<string, string>,
    file: { name: string; type: string; bytes: Buffer } = {
      name: 'site.png',
      type: 'image/png',
      bytes: PNG,
    },
    as = token,
  ) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
    return uploadDocument(req('POST', '/api/v1/documents', { form, token: as }), undefined);
  }

  async function list(entity_type: string, entity_id: string, as = token) {
    const response = await listDocuments(
      req('GET', `/api/v1/documents?entity_type=${entity_type}&entity_id=${entity_id}`, {
        token: as,
      }),
      undefined,
    );
    return (await response.json()) as { data: { id: string; is_public: boolean }[] };
  }

  it('stores the file, lists the row, and serves the bytes back', async () => {
    const response = await upload({
      entity_type: 'project',
      entity_id: projectId,
      document_type: 'gallery_image',
      is_public: 'true',
      notes: 'Front elevation',
    });
    expect(response.status).toBe(201);
    const document = (await response.json()).data as Record<string, unknown>;

    expect(document).toMatchObject({
      entity_type: 'project',
      document_type: 'gallery_image',
      file_name: 'site.png',
      file_size: PNG.byteLength,
      mime_type: 'image/png',
      is_public: true,
      notes: 'Front elevation',
      has_file: true,
    });
    /* the key is the one thing the browser must never be told */
    expect(document).not.toHaveProperty('storage_key');

    const file = await getFile(
      req('GET', `/api/v1/documents/${document.id}/file`, { token }),
      ctx(document.id as string),
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('asks the owning record for the right, not a module of its own', async () => {
    /* the clerk may read projects, so they may read a project's papers */
    const uploaded = await upload({
      entity_type: 'project',
      entity_id: projectId,
      document_type: 'brochure',
    });
    expect(uploaded.status).toBe(201);
    expect((await list('project', projectId, viewerToken)).data).toHaveLength(1);

    /* ...but reading is not attaching */
    const refused = await upload(
      { entity_type: 'project', entity_id: projectId, document_type: 'brochure' },
      { name: 'b.png', type: 'image/png', bytes: PNG },
      viewerToken,
    );
    expect(refused.status).toBe(403);

    /* and a project right says nothing about a customer's identity papers */
    const customerDocs = await listDocuments(
      req('GET', `/api/v1/documents?entity_type=customer&entity_id=${customerId}`, {
        token: viewerToken,
      }),
      undefined,
    );
    expect(customerDocs.status).toBe(403);
  });

  it('refuses a file the upload rules do not accept', async () => {
    const response = await upload(
      { entity_type: 'project', entity_id: projectId, document_type: 'brochure' },
      { name: 'payload.exe', type: 'application/x-msdownload', bytes: Buffer.from('MZ') },
    );
    expect(response.status).toBe(422);
    expect(JSON.stringify((await response.json()).error)).toContain('cannot be uploaded');
  });

  it('only lets the website show the records the website has', async () => {
    const onProject = (await (
      await upload({
        entity_type: 'project',
        entity_id: projectId,
        document_type: 'gallery_image',
      })
    ).json()).data as { id: string };
    const onCustomer = (await (
      await upload({ entity_type: 'customer', entity_id: customerId, document_type: 'nid_copy' })
    ).json()).data as { id: string; is_public: boolean };

    /* a flag that would do nothing is not quietly stored as true */
    expect(onCustomer.is_public).toBe(false);
    const refused = await patchDocument(
      req('PATCH', `/api/v1/documents/${onCustomer.id}`, { body: { is_public: true }, token }),
      ctx(onCustomer.id),
    );
    expect(refused.status).toBe(422);

    const allowed = await patchDocument(
      req('PATCH', `/api/v1/documents/${onProject.id}`, { body: { is_public: true }, token }),
      ctx(onProject.id),
    );
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()).data as { is_public: boolean }).is_public).toBe(true);
  });

  it('deletes the file along with the row', async () => {
    const document = (await (
      await upload({
        entity_type: 'project',
        entity_id: projectId,
        document_type: 'gallery_image',
      })
    ).json()).data as { id: string };

    const deleted = await deleteDocument(
      req('DELETE', `/api/v1/documents/${document.id}`, { token }),
      ctx(document.id),
    );
    expect(deleted.status).toBe(204);
    expect((await list('project', projectId)).data).toHaveLength(0);

    /*
     * The row soft-deletes and the bytes are gone, so the file route can no
     * longer find the document at all.
     */
    const file = await getFile(
      req('GET', `/api/v1/documents/${document.id}/file`, { token }),
      ctx(document.id),
    );
    expect(file.status).toBe(404);
  });
});
