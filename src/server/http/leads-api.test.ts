import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as listLeads, POST as createLead } from '@/app/api/v1/leads/route';
import { GET as getSummary } from '@/app/api/v1/leads/summary/route';
import { GET as getQueue } from '@/app/api/v1/leads/queue/route';
import {
  DELETE as deleteLead,
  GET as getLead,
  PATCH as patchLead,
} from '@/app/api/v1/leads/[id]/route';
import { POST as setStatus } from '@/app/api/v1/leads/[id]/status/route';
import { POST as completeStage } from '@/app/api/v1/leads/[id]/stage/route';
import { PUT as assign } from '@/app/api/v1/leads/[id]/assignment/route';
import { POST as logActivity } from '@/app/api/v1/leads/[id]/activities/route';
import { POST as convert } from '@/app/api/v1/leads/[id]/convert/route';
import { hashPassword } from '@/server/auth/password';
import { clearPermissionCache } from '@/server/auth/rbac';
import { hasTestDb, resetDb, testDb, type TestDb } from '@/test/db';

/*
 * Leads — the start of the story.
 *
 * Most of these are about the two rules the module leans on: the phone number
 * says whether two inquiries are one person, and nothing moves without leaving
 * an entry in the follow-up log. The rest is what no column holds — the open
 * follow-up date, which is the newest activity's, and the call queue that is
 * worked out from it.
 */

const suite = hasTestDb ? describe : describe.skip;
type Json = Record<string, unknown>;

function req(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

const YEAR = new Date().getUTCFullYear();
const dayOf = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

suite('leads API', () => {
  let db: TestDb;
  let hash = '';
  let token: string;
  let execToken: string;
  let projectId: string;
  let managerId: string;

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
            { module: 'crm', level: 'full' },
            { module: 'share_sale', level: 'full' },
          ],
        },
      },
    });
    /*
     * A sales executive owns their own leads: they may create and edit, but
     * assignment is a manager's decision, so `approve` is what they lack.
     */
    await db.role.create({
      data: {
        code: 'sales_executive',
        name: 'Sales Executive',
        permissions: {
          create: [
            { module: 'crm', level: 'own' },
            { module: 'share_sale', level: 'view' },
          ],
        },
      },
    });

    const manager = await db.user.create({
      data: { name: 'Nasreen', phone: '01711000001', password_hash: hash, role_code: 'super_admin' },
    });
    managerId = manager.id;
    await db.user.create({
      data: { name: 'Arif', phone: '01711000002', password_hash: hash, role_code: 'sales_executive' },
    });
    token = await signIn('01711000001');
    execToken = await signIn('01711000002');

    const project = await db.project.create({
      data: { code: `PRJ-${YEAR}-001`, name: 'Sea Pearl Hotel' },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const TANVIR = { name: 'Tanvir Hasan', phone: '01811 22 33 44', source: 'walk_in' as const };

  async function capture(body: Json, as = token) {
    const response = await createLead(req('POST', '/api/v1/leads', { body, token: as }), undefined);
    return {
      response,
      body: (await response.json()) as {
        data: { merged: boolean; lead: Json };
        error?: { message: string; fields?: Json };
      },
    };
  }

  async function open(id: string, as = token) {
    const response = await getLead(req('GET', `/api/v1/leads/${id}`, { token: as }), ctx(id));
    return {
      response,
      body: (await response.json()) as { data: Json; error?: { message: string } },
    };
  }

  async function newLead(extra: Json = {}): Promise<string> {
    const { body } = await capture({ ...TANVIR, ...extra });
    return body.data.lead.id as string;
  }

  /* -------------------------------------------------------------- *
   * An inquiry arrives
   * -------------------------------------------------------------- */

  it('opens a lead, numbers it, and keeps the number in one shape', async () => {
    const { response, body } = await capture({
      ...TANVIR,
      email: 'TANVIR@example.test',
      budget_range: '1 – 1.5 Crore',
      interested_project_id: projectId,
      inquiry_message: 'Asked about the hotel round',
      source: 'website_form',
      page_url: '/projects/sea-pearl',
      utm_source: 'facebook',
    });

    expect(response.status).toBe(201);
    expect(body.data.merged).toBe(false);
    expect(body.data.lead).toMatchObject({
      code: `LED-${YEAR}-001`,
      name: 'Tanvir Hasan',
      // typed with spaces, stored as it would be dialled
      phone: '01811223344',
      email: 'tanvir@example.test',
      status: 'new',
      source: 'website_form',
      utm_source: 'facebook',
      activity_count: 0,
      next_follow_up: null,
    });
  });

  it('refuses a number that cannot be dialled', async () => {
    const { response, body } = await capture({ ...TANVIR, phone: '12345' });
    expect(response.status).toBe(422);
    expect(body.error?.fields).toHaveProperty('phone');
  });

  it('adds a repeat inquiry to the lead that already has the number', async () => {
    const first = await newLead({ source: 'phone_call' });

    const { response, body } = await capture({
      name: 'Tanvir',
      // the same person, written the way the website sends it
      phone: '+8801811223344',
      source: 'website_form',
      budget_range: '2 – 3 Crore',
      interested_project_id: projectId,
      inquiry_message: 'Came back about the hotel',
    });

    expect(response.status).toBe(201);
    expect(body.data.merged).toBe(true);
    expect(body.data.lead.id).toBe(first);

    // one lead, and the second inquiry is in its log instead
    expect(await db.lead.count()).toBe(1);
    const { body: detail } = await open(first);
    const activities = detail.data.activities as Array<Json>;
    expect(activities).toHaveLength(1);
    expect(activities[0]!.notes).toContain('Repeat inquiry via website form');
    expect(activities[0]!.notes).toContain('Sea Pearl Hotel');

    // what the lead was missing is filled in; it had no budget before
    expect(detail.data.budget_range).toBe('2 – 3 Crore');
    expect(detail.data.interested_project_id).toBe(projectId);
    // and the repeat note puts it on today's call list
    expect(detail.data.next_follow_up).toBe(dayOf(0));
  });

  it('never overwrites what the desk already recorded', async () => {
    const id = await newLead({ budget_range: 'Under 50 Lakh', email: 'first@example.test' });
    await capture({
      ...TANVIR,
      budget_range: 'Above 3 Crore',
      email: 'second@example.test',
    });

    const { body } = await open(id);
    expect(body.data.budget_range).toBe('Under 50 Lakh');
    expect(body.data.email).toBe('first@example.test');
  });

  it('tells the form whose lead a number already is', async () => {
    await newLead();
    const response = await listLeads(
      req('GET', '/api/v1/leads?by_phone=01811223344', { token }),
      undefined,
    );
    const body = (await response.json()) as { data: { lead: Json | null } };
    expect(body.data.lead).toMatchObject({ code: `LED-${YEAR}-001`, name: 'Tanvir Hasan' });
  });

  /* -------------------------------------------------------------- *
   * Finding them again
   * -------------------------------------------------------------- */

  async function list(query = '', as = token) {
    const response = await listLeads(req('GET', `/api/v1/leads${query}`, { token: as }), undefined);
    const body = (await response.json()) as { data: Json[]; meta: { total: number } };
    return { response, rows: body.data, total: body.meta?.total };
  }

  it('finds a lead by a number typed with spaces, and filters the pipeline', async () => {
    await newLead();
    await capture({
      name: 'Shirin Akter',
      phone: '01911223344',
      source: 'referral',
      assigned_to: managerId,
    });

    expect((await list('?search=01811 22')).rows).toHaveLength(1);
    expect((await list('?search=shirin')).rows).toHaveLength(1);
    expect((await list(`?search=LED-${YEAR}-001`)).rows).toHaveLength(1);
    expect((await list('?source=referral')).rows).toHaveLength(1);
    expect((await list('?assigned_to=unassigned')).rows).toHaveLength(1);
    expect((await list(`?assigned_to=${managerId}`)).rows).toHaveLength(1);
    expect((await list('?status=new')).total).toBe(2);
  });

  it('counts the activity, the last touch and the names on a list row', async () => {
    const id = await newLead({ interested_project_id: projectId, assigned_to: managerId });
    await logActivity(
      req('POST', `/api/v1/leads/${id}/activities`, {
        token,
        body: {
          activity_type: 'call',
          notes: 'Rang him, wants the prospectus',
          activity_date: `${dayOf(-2)}T10:00:00.000Z`,
          next_follow_up_date: dayOf(-1),
        },
      }),
      ctx(id),
    );

    const { rows } = await list();
    expect(rows[0]).toMatchObject({
      activity_count: 1,
      next_follow_up: dayOf(-1),
      assignee_name: 'Nasreen',
      project_name: 'Sea Pearl Hotel',
      project_code: `PRJ-${YEAR}-001`,
    });
    expect(rows[0]!.last_activity_at).toContain(dayOf(-2));
  });

  /* -------------------------------------------------------------- *
   * The follow-up, which no column holds
   * -------------------------------------------------------------- */

  async function logged(id: string, notes: string, followUp: string | null, at = dayOf(0)) {
    const response = await logActivity(
      req('POST', `/api/v1/leads/${id}/activities`, {
        token,
        body: {
          activity_type: 'call',
          notes,
          activity_date: `${at}T09:00:00.000Z`,
          next_follow_up_date: followUp,
        },
      }),
      ctx(id),
    );
    expect(response.status).toBe(201);
  }

  it('takes the newest activity as the open follow-up', async () => {
    const id = await newLead();
    await logged(id, 'First call', dayOf(5), dayOf(-3));
    await logged(id, 'Called again, he will decide next week', dayOf(2), dayOf(-1));

    const { body } = await open(id);
    // the later entry supersedes the earlier one — not the earliest date
    expect(body.data.next_follow_up).toBe(dayOf(2));
  });

  it('counts overdue and due-today the way the list filters them', async () => {
    const late = await newLead();
    await logged(late, 'Should have rung back', dayOf(-2), dayOf(-4));

    const { body: second } = await capture({
      name: 'Shirin Akter',
      phone: '01911223344',
      source: 'referral',
    });
    await logged(second.data.lead.id as string, 'Due today', dayOf(0));

    const { body: third } = await capture({
      name: 'Kamal Uddin',
      phone: '01611223344',
      source: 'walk_in',
    });
    await logged(third.data.lead.id as string, 'Next month', dayOf(20));

    const summary = await getSummary(req('GET', '/api/v1/leads/summary', { token }), undefined);
    expect((await summary.json()) as Json).toMatchObject({
      data: { overdue: 1, due_today: 1, unassigned: 3, total: 3 },
    });

    expect((await list('?follow_up=overdue')).rows).toHaveLength(1);
    expect((await list('?follow_up=today')).rows).toHaveLength(1);

    const queue = await getQueue(req('GET', '/api/v1/leads/queue', { token }), undefined);
    const rows = ((await queue.json()) as { data: Array<{ date: string }> }).data;
    // overdue first, then today's — and nothing scheduled for later
    expect(rows.map((row) => row.date)).toEqual([dayOf(-2), dayOf(0)]);
  });

  it('drops a closed lead off the call queue', async () => {
    const id = await newLead();
    await logged(id, 'Overdue call', dayOf(-2), dayOf(-4));
    const lost = await setStatus(
      req('POST', `/api/v1/leads/${id}/status`, {
        token,
        body: { status: 'lost', notes: 'Price too high' },
      }),
      ctx(id),
    );
    expect(lost.status).toBe(200);

    const summary = await getSummary(req('GET', '/api/v1/leads/summary', { token }), undefined);
    expect((await summary.json()) as Json).toMatchObject({ data: { overdue: 0, unassigned: 0 } });
    const { body } = await open(id);
    expect(body.data.next_follow_up).toBeNull();
  });

  it('refuses an activity that claims to be a status change', async () => {
    const id = await newLead();
    const response = await logActivity(
      req('POST', `/api/v1/leads/${id}/activities`, {
        token,
        body: { activity_type: 'status_change', notes: 'Moved it myself' },
      }),
      ctx(id),
    );
    expect(response.status).toBe(422);
  });

  /* -------------------------------------------------------------- *
   * Moving it along
   * -------------------------------------------------------------- */

  it('completes a stage: the log keeps what happened, the lead moves on', async () => {
    const id = await newLead();
    const response = await completeStage(
      req('POST', `/api/v1/leads/${id}/stage`, {
        token,
        body: {
          to: 'contacted',
          activity_type: 'call',
          event_date: dayOf(0),
          title: 'Contact Made',
          details: { How: 'Phone call', 'Looking for': '4 shares' },
          notes: 'Wants the hotel round',
          next_follow_up_date: dayOf(3),
          updates: { budget_range: '1 – 1.5 Crore', interested_project_id: projectId },
        },
      }),
      ctx(id),
    );
    expect(response.status).toBe(200);

    const { body } = await open(id);
    expect(body.data).toMatchObject({
      status: 'contacted',
      budget_range: '1 – 1.5 Crore',
      interested_project_id: projectId,
      next_follow_up: dayOf(3),
    });
    const activities = body.data.activities as Array<Json>;
    expect(activities[0]).toMatchObject({
      activity_type: 'call',
      notes: 'Contact Made. Wants the hotel round',
      details: { How: 'Phone call', 'Looking for': '4 shares' },
    });
  });

  it('will not let a status button claim a booking', async () => {
    const id = await newLead();
    const response = await setStatus(
      req('POST', `/api/v1/leads/${id}/status`, { token, body: { status: 'booked', notes: '' } }),
      ctx(id),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      'buying shares',
    );
  });

  it('asks why a lead is lost, and clears the reason on a revive', async () => {
    const id = await newLead();

    const bare = await setStatus(
      req('POST', `/api/v1/leads/${id}/status`, { token, body: { status: 'lost' } }),
      ctx(id),
    );
    expect(bare.status).toBe(422);

    await setStatus(
      req('POST', `/api/v1/leads/${id}/status`, {
        token,
        body: { status: 'lost', notes: 'Bought elsewhere' },
      }),
      ctx(id),
    );
    const { body: closed } = await open(id);
    expect(closed.data).toMatchObject({ status: 'lost', lost_reason: 'Bought elsewhere' });

    await setStatus(
      req('POST', `/api/v1/leads/${id}/status`, {
        token,
        body: { status: 'negotiation', notes: 'Rang back, budget went up', next_follow_up_date: dayOf(1) },
      }),
      ctx(id),
    );
    const { body: revived } = await open(id);
    expect(revived.data).toMatchObject({
      status: 'negotiation',
      lost_reason: null,
      next_follow_up: dayOf(1),
    });
    // every move is in the log, so the history of the revive survives it
    expect((revived.data.activities as Json[]).map((a) => a.activity_type)).toEqual([
      'status_change',
      'status_change',
    ]);
  });

  /* -------------------------------------------------------------- *
   * Who owns it
   * -------------------------------------------------------------- */

  it('leaves assignment to a manager, and logs it', async () => {
    const id = await newLead();

    const refused = await assign(
      req('PUT', `/api/v1/leads/${id}/assignment`, {
        token: execToken,
        body: { assigned_to: managerId },
      }),
      ctx(id),
    );
    expect(refused.status).toBe(403);

    const response = await assign(
      req('PUT', `/api/v1/leads/${id}/assignment`, { token, body: { assigned_to: managerId } }),
      ctx(id),
    );
    expect(response.status).toBe(200);

    const { body } = await open(id);
    expect(body.data.assignee).toMatchObject({ name: 'Nasreen' });
    expect((body.data.activities as Json[])[0]!.notes).toBe('Assigned to Nasreen.');

    const cleared = await assign(
      req('PUT', `/api/v1/leads/${id}/assignment`, { token, body: { assigned_to: null } }),
      ctx(id),
    );
    expect(cleared.status).toBe(200);
    const { body: after } = await open(id);
    expect(after.data.assignee).toBeNull();
  });

  /* -------------------------------------------------------------- *
   * Lead → investor
   * -------------------------------------------------------------- */

  async function convertLead(id: string, body: Json = {}, as = token) {
    const response = await convert(
      req('POST', `/api/v1/leads/${id}/convert`, { token: as, body }),
      ctx(id),
    );
    return {
      response,
      body: (await response.json()) as {
        data: { existing: boolean; customer: Json; lead: Json };
        error?: { message: string };
      },
    };
  }

  it('opens the investor file from the lead and links the two', async () => {
    const id = await newLead({ email: 'tanvir@example.test' });
    const { response, body } = await convertLead(id);

    expect(response.status).toBe(200);
    expect(body.data.existing).toBe(false);
    expect(body.data.customer).toMatchObject({
      code: `CUST-${YEAR}-001`,
      name: 'Tanvir Hasan',
      phone: '01811223344',
    });

    const customer = await db.customer.findUniqueOrThrow({
      where: { id: body.data.customer.id as string },
    });
    expect(customer.lead_id).toBe(id);
    expect(customer.email).toBe('tanvir@example.test');

    // the lead keeps its status — booked follows a purchase, not a customer file
    const { body: detail } = await open(id);
    expect(detail.data.status).toBe('new');
    expect(detail.data.customer).toMatchObject({ code: `CUST-${YEAR}-001` });
    expect((detail.data.activities as Json[])[0]!.notes).toContain('opened from this lead');
  });

  it('links an investor already on file instead of making a second one', async () => {
    const existing = await db.customer.create({
      data: { code: `CUST-${YEAR}-009`, name: 'Tanvir H.', phone: '01811223344' },
    });
    const id = await newLead();

    const { body } = await convertLead(id);
    expect(body.data.existing).toBe(true);
    expect(body.data.customer.id).toBe(existing.id);
    expect(await db.customer.count()).toBe(1);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: existing.id } })).lead_id,
    ).toBe(id);
  });

  it('will not make an investor out of a lost lead', async () => {
    const id = await newLead();
    await setStatus(
      req('POST', `/api/v1/leads/${id}/status`, {
        token,
        body: { status: 'lost', notes: 'Not responding' },
      }),
      ctx(id),
    );
    const { response } = await convertLead(id);
    expect(response.status).toBe(409);
  });

  it('needs the share-sale right as well as the CRM one', async () => {
    const id = await newLead();
    const { response } = await convertLead(id, {}, execToken);
    expect(response.status).toBe(403);
  });

  /* -------------------------------------------------------------- *
   * Editing and deleting
   * -------------------------------------------------------------- */

  it('refuses to move a number onto a lead that is not its own', async () => {
    const first = await newLead();
    const { body: second } = await capture({
      name: 'Shirin Akter',
      phone: '01911223344',
      source: 'referral',
    });

    const response = await patchLead(
      req('PATCH', `/api/v1/leads/${second.data.lead.id}`, {
        token,
        body: { phone: '01811223344' },
      }),
      ctx(second.data.lead.id as string),
    );
    expect(response.status).toBe(422);
    expect(
      ((await response.json()) as { error: { fields: { phone: string } } }).error.fields.phone,
    ).toContain(`LED-${YEAR}-001`);
    expect((await db.lead.findUniqueOrThrow({ where: { id: first } })).phone).toBe('01811223344');
  });

  it('keeps a lead that became an investor, and deletes one that did not', async () => {
    const bought = await newLead();
    await convertLead(bought);
    const refused = await deleteLead(
      req('DELETE', `/api/v1/leads/${bought}`, { token }),
      ctx(bought),
    );
    expect(refused.status).toBe(409);

    const { body: other } = await capture({
      name: 'Kamal Uddin',
      phone: '01611223344',
      source: 'walk_in',
    });
    const id = other.data.lead.id as string;
    const gone = await deleteLead(req('DELETE', `/api/v1/leads/${id}`, { token }), ctx(id));
    expect(gone.status).toBe(204);

    expect((await list()).total).toBe(1);
    const { response } = await open(id);
    expect(response.status).toBe(404);

    /*
     * The row is still there holding its number, which is unique — so the
     * service has to say who had it rather than letting Postgres refuse the
     * insert with a message nobody can act on.
     */
    const again = await capture({ name: 'Kamal again', phone: '01611223344', source: 'walk_in' });
    expect(again.response.status).toBe(422);
    expect((again.body.error?.fields as { phone: string }).phone).toContain('deleted');
  });

  it('writes an audit row for the lead and for its log', async () => {
    const id = await newLead();
    await logged(id, 'Rang him', dayOf(2));

    const rows = await db.auditLog.findMany({
      where: { record_id: { in: [id] } },
      select: { action: true, table_name: true },
    });
    expect(rows.some((row: { table_name: string }) => row.table_name === 'leads')).toBe(true);
    const activity = await db.auditLog.findFirst({ where: { table_name: 'lead_activities' } });
    expect(activity).not.toBeNull();
  });
});
