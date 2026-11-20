import { prisma } from '../db/prisma';

/**
 * Users — only as much as the other modules need of them.
 *
 * The Users & Roles screen itself is S4 (it still renders the prototype's
 * static matrix). What is here is the one read every other module wants: the
 * people a record can be assigned to, by name.
 */

export interface AssignableUser {
  id: string;
  name: string;
  role_code: string;
}

/** The roles a project can be handed to. */
const MANAGER_ROLES = ['project_manager', 'management', 'super_admin'];

/**
 * Who can be a project manager: name and role, nothing else.
 *
 * Deliberately not the user list — no phone, no email, no status, no login
 * history. A picker needs a name; anything more would put the staff directory
 * behind a project-view right.
 */
export async function listAssignableManagers(): Promise<AssignableUser[]> {
  return prisma.user.findMany({
    where: { status: 'active', role_code: { in: MANAGER_ROLES } },
    select: { id: true, name: true, role_code: true },
    orderBy: { name: 'asc' },
  });
}

/** The roles that carry leads (`domain/lead.ts` — assignment is manual). */
const SALES_ROLES = ['sales_executive', 'sales_manager', 'head_of_sales'];

/**
 * Who a lead can be handed to.
 *
 * `super_admin` is in the list as well, because on a fresh install it is the
 * only user there is — without it the first lead could not be assigned to
 * anybody at all.
 */
export async function listSalesTeam(): Promise<AssignableUser[]> {
  return prisma.user.findMany({
    where: { status: 'active', role_code: { in: [...SALES_ROLES, 'super_admin'] } },
    select: { id: true, name: true, role_code: true },
    orderBy: { name: 'asc' },
  });
}
