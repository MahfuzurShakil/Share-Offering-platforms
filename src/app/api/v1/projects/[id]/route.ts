import { requirePerm } from '@/server/auth/rbac';
import { handler, noContent, ok, readJson } from '@/server/http/respond';
import { deleteProject, getProject, updateProject } from '@/server/services/project.service';
import { ProjectUpdate } from '../schema';

type Context = { params: Promise<{ id: string }> };

export const GET = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'project', 'view');
  const { id } = await params;
  return ok(await getProject(principal, id));
});

export const PATCH = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'project', 'edit');
  const { id } = await params;
  const input = await readJson(request, ProjectUpdate);
  return ok(await updateProject(principal, id, input));
});

/**
 * Soft-deletes the project with its documents, or 409 with the reason it
 * cannot be — a project with money against it is closed, not deleted.
 */
export const DELETE = handler<Context>(async (request, { params }) => {
  const principal = await requirePerm(request, 'project', 'edit');
  const { id } = await params;
  await deleteProject(principal, id);
  return noContent();
});
