/**
 * Soft delete, applied to the models that carry `deleted_at`.
 *
 * Two halves, both in one place so neither can drift:
 *   * a `delete` becomes an `update` that stamps `deleted_at`
 *   * every read gets `deleted_at: null` folded into its filter
 *
 * Financial records are not in this list and never will be: a payment, an
 * installment, a commission posting or a journal line is corrected by a
 * reversing entry, not hidden (AGENTS.md).
 */

/** Models with a `deleted_at` column. */
export const SOFT_DELETE_MODELS = new Set([
  'LookupValue',
  'User',
  'Document',
  'Project',
  'Lead',
  'Customer',
  'ShareOffering',
  'ShareSale',
  'RevenuePolicy',
  'RevenueEntry',
  'RevenuePeriod',
  'ProfitWithdrawal',
  'OrgMember',
  'BankAccount',
  'Partner',
  'CommissionPlan',
  /*
   * Not here, and never: ShareInstallment, SharePayment and
   * SharePaymentAllocation. A payment is corrected by a reversing payment, and
   * the database refuses to update or delete one at all (the trigger in
   * `20261119000000_share_sale_slice`). An installment is the agreed schedule,
   * which is rewritten in place while a purchase is still being arranged.
   * ProfitAllocation is not here either: a holder's share of a declared
   * period is frozen when it is written, and a mistake is corrected by an
   * adjustment in the next period (REVENUE-SHARE-PLAN.md section 2.3).
   *
   * Nor OrgMove, CommissionLine or CommissionPayout. A move is the history a
   * past commission is read through, so hiding one would silently re-write what
   * an old sale earned. A line is voided rather than deleted, with the reason
   * on it. A payout is money that left, and the database refuses to change one.
   */
]);

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

export function withSoftDelete<T extends { $extends: unknown }>(client: T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || !SOFT_DELETE_MODELS.has(model)) return query(args);

          /*
           * `includeDeleted: true` on the call is the way to ask for the
           * deleted rows as well — the recycle bin, and the audit screen that
           * has to show what a deleted record was.
           */
          if (args && typeof args === 'object' && args.includeDeleted) {
            delete args.includeDeleted;
            return query(args);
          }

          if (READ_OPS.has(operation)) {
            const where = args?.where ?? {};
            /*
             * findUnique only accepts unique fields in `where`, so it cannot
             * carry `deleted_at`. It becomes findFirst, which can.
             */
            if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const self = (client as any)[lower(model)];
              const fn = operation === 'findUnique' ? self.findFirst : self.findFirstOrThrow;
              return fn.call(self, { ...args, where: { ...where, deleted_at: null } });
            }
            return query({ ...args, where: { ...where, deleted_at: null } });
          }

          if (operation === 'delete') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (client as any)[lower(model)].update({
              where: args.where,
              data: { deleted_at: new Date() },
            });
          }

          if (operation === 'deleteMany') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (client as any)[lower(model)].updateMany({
              where: { ...(args?.where ?? {}), deleted_at: null },
              data: { deleted_at: new Date() },
            });
          }

          // an update must not resurrect or touch a deleted row
          if (operation === 'updateMany') {
            return query({ ...args, where: { ...(args?.where ?? {}), deleted_at: null } });
          }

          return query(args);
        },
      },
    },
  });
}

function lower(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
