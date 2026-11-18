/**
 * The permission vocabulary, shared by the server and the browser.
 *
 * The server decides — every route handler asks `requirePerm` before it does
 * anything (AGENTS.md). The browser asks the same questions of the same
 * vocabulary so it can hide a menu item the person cannot use, which is
 * presentation, not protection.
 *
 * Levels and module keys live here, pure, because both sides need them and
 * neither owns them. What a role actually holds lives in `role_permissions`
 * rows the client edits, not in a table in code.
 */

export type AccessLevel = 'full' | 'approve' | 'create' | 'view' | 'own' | 'none';

export const ACCESS_LEVELS: readonly AccessLevel[] = [
  'full',
  'approve',
  'create',
  'view',
  'own',
  'none',
];

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  full: 'Full',
  approve: 'Approve',
  create: 'Create',
  view: 'View',
  own: 'Own only',
  none: '—',
};

/** The modules this product has. A new module adds a key here and a seed row. */
export const PERMISSION_MODULES = [
  'dashboard',
  'project',
  'crm',
  'share_sale',
  'sales_team',
  'finance_collection',
  'finance_expense',
  'master_data',
  'user_management',
  'website',
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_MODULE_LABEL: Record<PermissionModule, string> = {
  dashboard: 'Dashboard',
  project: 'Projects',
  crm: 'Leads / CRM',
  share_sale: 'Share Sale',
  sales_team: 'Sales Team & Commission',
  finance_collection: 'Money in — receipts and collections',
  finance_expense: 'Money out — fund, loans and payouts',
  master_data: 'Master Data & Company Settings',
  user_management: 'Users & Roles',
  website: 'Website content & blog',
};

/** What a caller is trying to do, in the order of how much it needs. */
export type Ability = 'view' | 'create' | 'edit' | 'approve';

/**
 * Whether a level allows an ability.
 *
 * `own` means "their own records only": it allows viewing and creating and
 * editing, and the *service* narrows the query to what belongs to them — a
 * sales executive editing their own lead, not their colleague's. A level alone
 * can never express that scoping, so it is checked here and applied there.
 */
export function allows(level: AccessLevel, ability: Ability): boolean {
  switch (ability) {
    case 'view':
      return level !== 'none';
    case 'create':
      return level === 'full' || level === 'create' || level === 'own';
    case 'edit':
      return level === 'full' || level === 'own';
    case 'approve':
      return level === 'full' || level === 'approve';
    default:
      return false;
  }
}

/** True when the level only covers the person's own records. */
export function isOwnOnly(level: AccessLevel): boolean {
  return level === 'own';
}

export function isAccessLevel(value: string): value is AccessLevel {
  return (ACCESS_LEVELS as readonly string[]).includes(value);
}

export function isPermissionModule(value: string): value is PermissionModule {
  return (PERMISSION_MODULES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Which module a screen belongs to
 * ------------------------------------------------------------------ */

/**
 * The admin routes and the module each one answers to.
 *
 * Longest prefix wins, so a nested screen can belong to a different module
 * than the section it sits under. The prototype's map also carried the land,
 * construction and procurement routes; they come back with their modules.
 */
const ROUTE_MODULES: Array<[string, PermissionModule]> = [
  ['/admin/projects', 'project'],
  ['/admin/leads', 'crm'],
  ['/admin/customers', 'share_sale'],
  ['/admin/share-sale/profit', 'finance_collection'],
  ['/admin/share-sale/withdrawals', 'finance_expense'],
  ['/admin/share-sale', 'share_sale'],
  ['/admin/sales-team', 'sales_team'],
  ['/admin/cash', 'finance_expense'],
  ['/admin/fund', 'finance_expense'],
  ['/admin/users', 'user_management'],
  ['/admin/master-data', 'master_data'],
  ['/admin/settings', 'master_data'],
  ['/admin/website', 'website'],
  ['/admin/blog', 'website'],
];

/** The module a path belongs to, or null for a screen nobody has to hold rights to. */
export function moduleForPath(pathname: string): PermissionModule | null {
  const match = ROUTE_MODULES.filter(([prefix]) => pathname.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return match?.[1] ?? null;
}

/** True when the path is a form — creating or editing, which needs more than view. */
export function isFormPath(pathname: string): boolean {
  return /\/(new|edit)(\/|$)/.test(pathname) || pathname.endsWith('/new');
}
