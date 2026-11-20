import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import { deleteMember, getMember, updateMember } from '@/server/services/org.service';
import { MemberUpdate } from '../schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'view');
  const { id } = await params;
  return ok(await getMember(id));
});

/** Their own details. Who they report to moves through the move route. */
export const PATCH = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'edit');
  const { id } = await params;
  return ok(await updateMember(id, await readJson(request, MemberUpdate)));
});

/**
 * Only somebody who never sold anything and earned nothing — a row that should
 * not have been typed. A real person who has gone is marked as having left,
 * because their name is on every commission line they earned.
 */
export const DELETE = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'sales_team', 'edit');
  const { id } = await params;
  await deleteMember(id);
  return noContent();
});
