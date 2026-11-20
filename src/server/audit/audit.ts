import { Prisma } from '@prisma/client';
import { currentActor, currentActorId } from './context';

/**
 * Record-level change history, written by the client itself.
 *
 * Every create, update and delete through Prisma leaves an `audit_log` row:
 * what changed, from what to what, by whom, when. Putting it in an extension
 * rather than in each service is the whole point — a service cannot forget it,
 * and a new module gets it without doing anything.
 *
 * `audit_log` is append-only, enforced by a trigger in the first migration.
 */

/** Tables that are not worth auditing: the log itself, and plumbing. */
const SKIP = new Set(['AuditLog', 'AuthAttempt', 'CodeSeries', 'Session', 'OtpCode']);

/** Columns never copied into the log, whatever table they are on. */
const NEVER_LOG = new Set([
  'password_hash',
  'token_hash',
  'code_hash',
  'file_data',
]);

const TABLE_OF: Record<string, string> = {
  LookupValue: 'lookup_values',
  CompanySettings: 'company_settings',
  Role: 'roles',
  RolePermission: 'role_permissions',
  User: 'users',
  UserProjectAssignment: 'user_project_assignments',
  Document: 'documents',
  Project: 'projects',
  Lead: 'leads',
  LeadActivity: 'lead_activities',
  Customer: 'customers',
  ShareOffering: 'share_offerings',
  ShareSale: 'share_sales',
  ShareInstallment: 'share_installments',
  SharePayment: 'share_payments',
  SharePaymentAllocation: 'share_payment_allocations',
  RevenuePolicy: 'revenue_policies',
  RevenueEntry: 'revenue_entries',
  RevenuePeriod: 'revenue_periods',
  ProfitAllocation: 'profit_allocations',
  ProfitWithdrawal: 'profit_withdrawals',
  OrgMember: 'org_members',
  OrgMove: 'org_moves',
  CommissionPlan: 'commission_plans',
  CommissionLine: 'commission_lines',
  CommissionPayout: 'commission_payouts',
};

type Json = Prisma.InputJsonValue;

/** Strips secrets and anything that is not worth keeping, then JSON-ifies. */
function scrub(row: unknown): Json | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (NEVER_LOG.has(key)) continue;
    if (value instanceof Date) out[key] = value.toISOString();
    else if (value instanceof Prisma.Decimal) out[key] = value.toString();
    else if (value === undefined) continue;
    else out[key] = value;
  }
  return out as Json;
}

/** Only the fields that actually changed, so an update's diff is readable. */
function changedOnly(before: Json | undefined, after: Json | undefined) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return { before, after };
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (key === 'updated_at') continue;
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      beforeDiff[key] = b[key];
      afterDiff[key] = a[key];
    }
  }
  return { before: beforeDiff as Json, after: afterDiff as Json };
}

const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const DELETE_OPS = new Set(['delete', 'deleteMany']);

/**
 * The audited client. Wrap the base client once, at `server/db/prisma.ts`'s
 * export, and every service inherits it.
 */
export function withAudit<T extends { $extends: unknown }>(client: T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).$extends({
    name: 'audit',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const action = CREATE_OPS.has(operation)
            ? 'create'
            : UPDATE_OPS.has(operation)
              ? 'update'
              : DELETE_OPS.has(operation)
                ? 'delete'
                : null;

          if (!action || !model || SKIP.has(model)) return query(args);

          const table = TABLE_OF[model] ?? model;
          const actor = currentActor();

          /*
           * The "before" has to be read before the write, and only for a
           * single-record operation — a `updateMany` over a filter would mean
           * loading every matching row, which is not worth it. Bulk writes are
           * logged as one row naming the filter instead.
           */
          const single = ['update', 'delete', 'upsert'].includes(operation) && args?.where;
          let before: Json | undefined;
          if (single) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const found = await (client as any)[lower(model)].findFirst({ where: args.where });
            before = scrub(found);
          }

          const result = await query(args);
          const after = action === 'delete' ? undefined : scrub(result);
          const diff = action === 'update' ? changedOnly(before, after) : { before, after };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = result as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any).auditLog.create({
            data: {
              action,
              actor_user_id: actor.user_id ?? null,
              actor_customer_id: actor.customer_id ?? null,
              actor_role: actor.role ?? null,
              table_name: table,
              record_id: typeof row?.id === 'string' ? row.id : null,
              record_code: typeof row?.code === 'string' ? row.code : null,
              before: diff.before ?? Prisma.DbNull,
              after: diff.after ?? Prisma.DbNull,
              ip: actor.ip ?? null,
              user_agent: actor.user_agent?.slice(0, 300) ?? null,
              request_id: actor.request_id ?? null,
            },
          });

          return result;
        },
      },
    },
  });
}

/** Writes an audit row for something that is not a table change: a sign-in. */
export async function auditEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  action: 'login' | 'logout' | 'login_failed' | 'permission_change' | 'export',
  detail: { table_name?: string; record_id?: string | null; after?: Json },
): Promise<void> {
  const actor = currentActor();
  await client.auditLog.create({
    data: {
      action,
      actor_user_id: actor.user_id ?? null,
      actor_customer_id: actor.customer_id ?? null,
      actor_role: actor.role ?? null,
      table_name: detail.table_name ?? 'sessions',
      record_id: detail.record_id ?? null,
      after: detail.after ?? Prisma.DbNull,
      ip: actor.ip ?? null,
      user_agent: actor.user_agent?.slice(0, 300) ?? null,
      request_id: actor.request_id ?? null,
    },
  });
}

/** The `created_by` to stamp on a new record. */
export { currentActorId };

function lower(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
