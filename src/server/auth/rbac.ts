import type { NextRequest } from 'next/server';
import {
  allows,
  isOwnOnly,
  type Ability,
  type AccessLevel,
  type PermissionModule,
} from '@/lib/domain/permissions';
import { prisma } from '../db/prisma';
import { SESSION_COOKIE, sessionForToken } from './session';

/**
 * Who is asking, and may they.
 *
 * Every route handler starts here (AGENTS.md). Hiding a menu item in the
 * browser is presentation; this is the boundary, and a test asserts that no
 * route under `app/api/v1` is missing it.
 *
 * Permissions are read from `role_permissions` rows, because the client
 * defines their own roles — the prototype's table in code could not be edited
 * by them, which is what the quotation promises.
 */

export interface StaffPrincipal {
  kind: 'staff';
  user_id: string;
  customer_id?: undefined;
  name: string;
  role: string;
  /** the projects they are scoped to; empty means every project */
  project_ids: string[];
  session_id: string;
}

export interface CustomerPrincipal {
  kind: 'customer';
  customer_id: string;
  user_id?: undefined;
  name: string;
  session_id: string;
}

export type Principal = StaffPrincipal | CustomerPrincipal;

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: 'unauthenticated' | 'forbidden' | 'suspended',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** The token on a request: the browser's cookie, or a mobile app's header. */
export function tokenFrom(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null;
  return request.cookies.get(SESSION_COOKIE)?.value ?? null;
}

/** The caller, or null when there is no live session. */
export async function principalFrom(request: NextRequest): Promise<Principal | null> {
  const session = await sessionForToken(tokenFrom(request));
  if (!session) return null;

  if (session.kind === 'staff' && session.user_id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user_id },
      select: {
        id: true,
        name: true,
        role_code: true,
        status: true,
        projects: { select: { project_id: true } },
      },
    });
    if (!user) return null;
    if (user.status !== 'active') {
      throw new AuthError(403, 'suspended', 'This account has been suspended.');
    }
    return {
      kind: 'staff',
      user_id: user.id,
      name: user.name,
      role: user.role_code,
      project_ids: user.projects.map((p: { project_id: string }) => p.project_id),
      session_id: session.id,
    };
  }

  if (session.kind === 'customer' && session.customer_id) {
    /*
     * Customers live in `customers`, which arrives with the share-sale slice
     * of the schema. Until then a customer session carries only its id — the
     * investor portal's own services look the person up themselves.
     */
    return {
      kind: 'customer',
      customer_id: session.customer_id,
      name: '',
      session_id: session.id,
    };
  }

  return null;
}

/** The caller, or 401. */
export async function requireAuth(request: NextRequest): Promise<Principal> {
  const principal = await principalFrom(request);
  if (!principal) throw new AuthError(401, 'unauthenticated', 'Please sign in.');
  return principal;
}

/** Staff only — the Admin Portal's API. */
export async function requireStaff(request: NextRequest): Promise<StaffPrincipal> {
  const principal = await requireAuth(request);
  if (principal.kind !== 'staff') {
    throw new AuthError(403, 'forbidden', 'This is not available on the Customer Portal.');
  }
  return principal;
}

/** An investor, for the Customer Portal's own API. */
export async function requireCustomer(request: NextRequest): Promise<CustomerPrincipal> {
  const principal = await requireAuth(request);
  if (principal.kind !== 'customer') {
    throw new AuthError(403, 'forbidden', 'Sign in on the Customer Portal to see this.');
  }
  return principal;
}

/*
 * A role's rights change rarely and are read on every request, so they are
 * cached briefly in the process. Short on purpose: taking a right away must
 * take effect in seconds, which is what "a widened access right is never
 * silent" implies in the other direction.
 */
const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; levels: Map<string, AccessLevel> }>();

export function clearPermissionCache(): void {
  cache.clear();
}

async function levelsFor(role: string): Promise<Map<string, AccessLevel>> {
  const hit = cache.get(role);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.levels;

  const rows = await prisma.rolePermission.findMany({
    where: { role: { code: role } },
    select: { module: true, level: true },
  });
  const levels = new Map<string, AccessLevel>(
    rows.map((r: { module: string; level: string }) => [r.module, r.level as AccessLevel]),
  );
  cache.set(role, { at: Date.now(), levels });
  return levels;
}

/** What this role may do in a module; `none` when nothing says otherwise. */
export async function levelFor(role: string, module: PermissionModule): Promise<AccessLevel> {
  return (await levelsFor(role)).get(module) ?? 'none';
}

export interface Permitted extends StaffPrincipal {
  level: AccessLevel;
  /** true when the caller may only touch their own records */
  own_only: boolean;
}

/**
 * The caller, checked against a module and what they are trying to do, or 403.
 *
 * `own_only` comes back rather than being enforced here: no permission check
 * can know which column means "theirs" on a given table, so the service
 * narrows the query and this says whether it must.
 */
export async function requirePerm(
  request: NextRequest,
  module: PermissionModule,
  ability: Ability = 'view',
): Promise<Permitted> {
  const staff = await requireStaff(request);
  const level = await levelFor(staff.role, module);

  if (!allows(level, ability)) {
    throw new AuthError(403, 'forbidden', 'Your role does not allow this.');
  }

  return { ...staff, level, own_only: isOwnOnly(level) };
}

/** Whether a scoped user may act on this project at all. */
export function withinScope(principal: StaffPrincipal, project_id: string | null): boolean {
  if (!project_id) return true;
  if (principal.project_ids.length === 0) return true;
  return principal.project_ids.includes(project_id);
}

/** 403 unless the project is one they are assigned to. */
export function assertWithinScope(principal: StaffPrincipal, project_id: string | null): void {
  if (!withinScope(principal, project_id)) {
    throw new AuthError(403, 'forbidden', 'That project is not one of yours.');
  }
}
