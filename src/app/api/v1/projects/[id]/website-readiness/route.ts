import { requirePerm } from '@/server/auth/rbac';
import { handler, ok } from '@/server/http/respond';
import { websiteReadiness } from '@/server/services/project.service';

type Context = { params: Promise<{ id: string }> };

/**
 * What this project still needs before the public site looks right.
 *
 * On `project: view` rather than `website`: it is read beside the publish
 * switch on the project's own page, by whoever is setting the project up.
 */
export const GET = handler<Context>(async (request, { params }) => {
  await requirePerm(request, 'project', 'view');
  const { id } = await params;
  return ok(await websiteReadiness(id));
});
