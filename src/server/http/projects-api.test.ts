import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listProjects, POST as createProject } from '@/app/api/v1/projects/route';
import {
  DELETE as deleteProject,
  GET as getProject,
  PATCH as patchProject,
} from '@/app/api/v1/projects/[id]/route';
import { PATCH as patchSales } from '@/app/api/v1/projects/[id]/sales-status/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * The Projects API end to end, against the real database: a request in, a reply
 * out, through the same handlers Next runs.
 *
 * This is the module that proves the path (PHASE-1-PLAN §Risks 1) — auth, zod,
 * RBAC, the code series, the audit extension and the Decimal/Date boundary all
 * on one route. What is asserted here is what the rest of the modules inherit.
 */

const suite = hasTestDb ? describe : describe.skip;

type Json = Record<string, unknown>;

function req(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  init: { body?: unknown; token?: string } = {},
) {
  const headers = new Headers();
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

suite('projects API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let viewerToken: string;
  let managerId: string;

  async function signIn(identifier: string, password: string): Promise<string> {
    const response = await login(
      req('POST', '/api/v1/auth/login', { body: { identifier, password } }),
      undefined,
    );
    const body = (await response.json()) as { data: { token: string } };
    expect(response.status).toBe(200);
    return body.data.token;
  }

  beforeEach(async () => {
    db ??= testDb();
    // argon2 is slow on purpose; one hash is enough for every fixture user
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
        permissions: {
          create: [
            { module: 'project', level: 'view' },
            { module: 'share_sale', level: 'view' },
          ],
        },
      },
    });

    const admin = await db.user.create({
      data: {
        name: 'Mahfuz Owner',
        phone: '01711000001',
        password_hash: hash,
        role_code: 'super_admin',
      },
    });
    managerId = admin.id;
    await db.user.create({
      data: {
        name: 'Accounts Clerk',
        phone: '01711000002',
        password_hash: hash,
        role_code: 'accounts',
      },
    });

    token = await signIn('01711000001', 'nokshi-green-2026');
    viewerToken = await signIn('01711000002', 'nokshi-green-2026');
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function create(body: Json, as = token) {
    const response = await createProject(req('POST', '/api/v1/projects', { body, token: as }), undefined);
    return { response, body: (await response.json()) as { data: Json; error?: Json } };
  }

  it('creates a project, numbers it from the series, and audits it', async () => {
    const { response, body } = await create({
      name: 'Green Court',
      location_summary: 'Bashundhara R/A, Dhaka',
      total_land_area: 12.5,
      total_land_area_unit: 'katha',
      expected_start_date: '2026-04-01',
      expected_completion_date: '2027-03-31',
      project_manager_id: managerId,
      amenities: ['Lift', 'Generator'],
    });

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      code: `PRJ-${new Date().getUTCFullYear()}-001`,
      name: 'Green Court',
      sales_status: 'not_open',
      status: 'planning',
      project_manager_name: 'Mahfuz Owner',
      is_public: false,
    });
    // Decimal and Date do not survive JSON: they cross as number and YYYY-MM-DD
    expect(body.data.total_land_area).toBe(12.5);
    expect(body.data.expected_start_date).toBe('2026-04-01');

    const second = await create({ name: 'Riverside Shares' });
    expect((second.body.data as Json).code).toBe(`PRJ-${new Date().getUTCFullYear()}-002`);

    const audit = await db.auditLog.findMany({
      where: { table_name: 'projects', action: 'create' },
      orderBy: { at: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      record_code: `PRJ-${new Date().getUTCFullYear()}-001`,
      actor_user_id: managerId,
      actor_role: 'super_admin',
    });
  });

  it('refuses a second project with the same name, and gives the field back', async () => {
    await create({ name: 'Green Court' });
    const { response, body } = await create({ name: '  green court ' });

    expect(response.status).toBe(422);
    expect((body.error as Json).fields).toHaveProperty('name');
  });

  it('refuses a sell-out date before the sales start', async () => {
    const { response } = await create({
      name: 'Backwards Dates',
      expected_start_date: '2027-01-01',
      expected_completion_date: '2026-01-01',
    });
    expect(response.status).toBe(422);
  });

  it('will not let a view-only role create, edit or delete', async () => {
    const created = await create({ name: 'Green Court' });
    const id = created.body.data.id as string;

    const posted = await create({ name: 'Theirs' }, viewerToken);
    expect(posted.response.status).toBe(403);

    const patched = await patchProject(
      req('PATCH', `/api/v1/projects/${id}`, { body: { name: 'Renamed' }, token: viewerToken }),
      ctx(id),
    );
    expect(patched.status).toBe(403);

    const removed = await deleteProject(
      req('DELETE', `/api/v1/projects/${id}`, { token: viewerToken }),
      ctx(id),
    );
    expect(removed.status).toBe(403);

    // but they can read it
    const read = await getProject(
      req('GET', `/api/v1/projects/${id}`, { token: viewerToken }),
      ctx(id),
    );
    expect(read.status).toBe(200);
  });

  it('answers 401 with no session at all', async () => {
    const response = await listProjects(req('GET', '/api/v1/projects'), undefined);
    expect(response.status).toBe(401);
  });

  it('searches, filters and pages the list in the database', async () => {
    await create({ name: 'Green Court', location_summary: 'Bashundhara' });
    await create({ name: 'Riverside Shares', location_summary: 'Keraniganj' });
    await create({ name: 'Hilltop Shares', location_summary: 'Sylhet' });

    const searched = await listProjects(req('GET', '/api/v1/projects?search=shares', { token }), undefined);
    const searchBody = (await searched.json()) as { data: Json[]; meta: Json };
    expect(searchBody.data.map((r) => r.name).sort()).toEqual(['Hilltop Shares', 'Riverside Shares']);
    expect(searchBody.meta.total).toBe(2);

    const paged = await listProjects(
      req('GET', '/api/v1/projects?page=2&page_size=2&sort=name', { token }),
      undefined,
    );
    const pagedBody = (await paged.json()) as { data: Json[]; meta: Json };
    expect(pagedBody.data).toHaveLength(1);
    expect(pagedBody.meta).toMatchObject({ page: 2, page_size: 2, total: 3 });
    // sorted by name, the third is Riverside
    expect(pagedBody.data[0]!.name).toBe('Riverside Shares');
  });

  it('shows a scoped user only the projects they are assigned to', async () => {
    const mine = await create({ name: 'Mine' });
    await create({ name: 'Theirs' });
    const clerk = await db.user.findFirstOrThrow({ where: { phone: '01711000002' } });
    await db.userProjectAssignment.create({
      data: { user_id: clerk.id, project_id: mine.body.data.id as string },
    });
    // the principal reads its scope on each request, so a fresh sign-in is not needed
    const response = await listProjects(req('GET', '/api/v1/projects', { token: viewerToken }), undefined);
    const body = (await response.json()) as { data: Json[]; meta: Json };

    expect(body.data.map((r) => r.name)).toEqual(['Mine']);
    expect(body.meta.total).toBe(1);

    const other = await db.project.findFirstOrThrow({ where: { name: 'Theirs' } });
    const read = await getProject(
      req('GET', `/api/v1/projects/${other.id}`, { token: viewerToken }),
      ctx(other.id),
    );
    expect(read.status).toBe(403);
  });

  it('updates only what was sent, and logs the difference', async () => {
    const { body } = await create({ name: 'Green Court', location_summary: 'Bashundhara' });
    const id = body.data.id as string;

    const response = await patchProject(
      req('PATCH', `/api/v1/projects/${id}`, {
        body: { location_summary: 'Purbachal, Dhaka' },
        token,
      }),
      ctx(id),
    );
    const patched = (await response.json()) as { data: Json };

    expect(response.status).toBe(200);
    expect(patched.data).toMatchObject({ name: 'Green Court', location_summary: 'Purbachal, Dhaka' });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { table_name: 'projects', action: 'update' },
    });
    expect(audit.before).toMatchObject({ location_summary: 'Bashundhara' });
    expect(audit.after).toMatchObject({ location_summary: 'Purbachal, Dhaka' });
    // an update's diff is only what changed, so the name is not in it
    expect(audit.after).not.toHaveProperty('name');
  });

  it('moves sales only along the moves that exist', async () => {
    const { body } = await create({ name: 'Green Court' });
    const id = body.data.id as string;

    const opened = await patchSales(
      req('PATCH', `/api/v1/projects/${id}/sales-status`, { body: { sales_status: 'open' }, token }),
      ctx(id),
    );
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { data: Json }).data.sales_status).toBe('open');

    const backToClosed = await patchSales(
      req('PATCH', `/api/v1/projects/${id}/sales-status`, {
        body: { sales_status: 'not_open' },
        token,
      }),
      ctx(id),
    );
    expect(backToClosed.status).toBe(409);

    const paused = await patchSales(
      req('PATCH', `/api/v1/projects/${id}/sales-status`, {
        body: { sales_status: 'paused' },
        token,
      }),
      ctx(id),
    );
    expect(paused.status).toBe(200);
  });

  it('will not feature a project that is not on the website', async () => {
    const { body } = await create({ name: 'Green Court' });
    const id = body.data.id as string;

    const featured = await patchProject(
      req('PATCH', `/api/v1/projects/${id}`, { body: { is_featured: true }, token }),
      ctx(id),
    );
    expect(featured.status).toBe(422);

    const published = await patchProject(
      req('PATCH', `/api/v1/projects/${id}`, {
        body: { is_public: true, is_featured: true },
        token,
      }),
      ctx(id),
    );
    expect(published.status).toBe(200);

    // and unpublishing takes it off the home page with it
    const hidden = await patchProject(
      req('PATCH', `/api/v1/projects/${id}`, { body: { is_public: false }, token }),
      ctx(id),
    );
    expect(((await hidden.json()) as { data: Json }).data.is_featured).toBe(false);
  });

  it('soft-deletes a project with its documents, and stops finding it', async () => {
    const { body } = await create({ name: 'Green Court' });
    const id = body.data.id as string;
    const clerk = await db.user.findFirstOrThrow({ where: { phone: '01711000002' } });
    await db.userProjectAssignment.create({ data: { user_id: clerk.id, project_id: id } });
    await db.document.create({
      data: { entity_type: 'project', entity_id: id, document_type: 'gallery_image' },
    });

    const response = await deleteProject(req('DELETE', `/api/v1/projects/${id}`, { token }), ctx(id));
    expect(response.status).toBe(204);

    const read = await getProject(req('GET', `/api/v1/projects/${id}`, { token }), ctx(id));
    expect(read.status).toBe(404);

    // the row is still there, with its code and its history
    const raw = await db.project.findFirst({ where: { id }, includeDeleted: true });
    expect(raw?.deleted_at).toBeInstanceOf(Date);
    expect(await db.document.count({ where: { entity_id: id } })).toBe(0);
    // a grant to a project that no longer exists is not history
    expect(await db.userProjectAssignment.count({ where: { project_id: id } })).toBe(0);
  });

  it('rejects a body that is not valid, naming the fields', async () => {
    const { response, body } = await create({
      name: 'x',
      total_land_area: -5,
      project_manager_id: 'not-a-uuid',
    });
    expect(response.status).toBe(422);
    const fields = (body.error as { fields: Json }).fields;
    expect(Object.keys(fields).sort()).toEqual(['name', 'project_manager_id', 'total_land_area']);
  });
});
