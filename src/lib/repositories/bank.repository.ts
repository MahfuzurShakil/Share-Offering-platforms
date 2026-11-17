'use client';

import { db } from '../db/database';
import type { BankAccount } from '../db/types';
import {
  positionForAccount,
  unattributed,
  type AccountPosition,
  type CashFlowRow,
} from '../domain/cash';
import { money } from '../domain/finance';
import { nextCode } from '../utils/id';
import { todayLocal } from '../utils/format';
import { BaseRepository } from './base.repository';

export interface AccountWithPosition extends BankAccount, Omit<AccountPosition, 'account_id'> {}

export interface CashPosition {
  accounts: AccountWithPosition[];
  /** Sum of the accounts' closing balances — the figure that reconciles. */
  total_balance: number;
  total_in: number;
  total_out: number;
  /** Money that moved through no account; never added to `total_balance`. */
  unattributed_in: number;
  unattributed_out: number;
  unattributed_count: number;
}

export class BankAccountInUseError extends Error {
  constructor(name: string) {
    super(`"${name}" has money recorded against it and cannot be deleted. Close it instead.`);
    this.name = 'BankAccountInUseError';
  }
}

/**
 * Bank accounts and the cash position (Tier 3.5).
 *
 * The four money tables are read once here and folded into a single list of
 * movements, so every screen showing cash is looking at the same rows. The
 * definition of what counts — and what deliberately does not — is on
 * `domain/cash.ts`, next to the arithmetic it governs.
 */
class BankAccountRepository extends BaseRepository<BankAccount> {
  constructor() {
    super(() => db.bank_accounts);
  }

  async generateCode(): Promise<string> {
    const codes = (await db.bank_accounts.toArray()).map((r) => r.code);
    return nextCode('ACC', codes);
  }

  async options(): Promise<BankAccount[]> {
    const rows = await db.bank_accounts.toArray();
    return rows.filter((r) => r.is_active).sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(): Promise<BankAccount[]> {
    const rows = await db.bank_accounts.toArray();
    return rows.sort(
      (a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name),
    );
  }

  async createAccount(
    input: Omit<BankAccount, 'id' | 'code' | 'created_at' | 'updated_at' | 'created_by'> & {
      code?: string;
    },
    createdBy: string | null = null,
  ): Promise<BankAccount> {
    if (!input.name.trim()) throw new Error('The account needs a name.');
    return this.create(
      {
        ...input,
        code: input.code?.trim() ? input.code : await this.generateCode(),
        name: input.name.trim(),
        opening_balance: money(Number(input.opening_balance) || 0),
        opening_balance_date: input.opening_balance_date || todayLocal(),
      },
      createdBy,
    );
  }

  /**
   * Every money movement, from the four tables that hold one.
   *
   * Read together rather than per account so the unattributed bucket can be
   * computed from the same pass — otherwise "what has no account" would be a
   * second, differently-shaped query that could disagree with the first.
   */
  async flows(): Promise<CashFlowRow[]> {
    const customers = await db.customers.toArray();
    const [fundIn, partners, sharePayments, shareSales] = await Promise.all([
      db.fund_receipts.toArray(),
      db.partners.toArray(),
      db.share_payments.toArray(),
      db.share_sales.toArray(),
    ]);
    const [revenueEntries, loanRepayments, loans, withdrawals, projects] = await Promise.all([
      db.revenue_entries.toArray(),
      db.loan_repayments.toArray(),
      db.loans.toArray(),
      db.profit_withdrawals.toArray(),
      db.projects.toArray(),
    ]);
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const loanById = new Map(loans.map((l) => [l.id, l]));
    const holderName = new Map<string, string>([
      ...customers.map((c) => [c.id, c.name] as const),
      ...partners.map((p) => [p.id, p.name] as const),
    ]);
    // REVENUE-SHARE-PLAN.md §7 — commission paid to the sales team, net of tax withheld
    const [commissionPayouts, orgMembers] = await Promise.all([db.commission_payouts.toArray(), db.org_members.toArray()]);
    const memberName = new Map(orgMembers.map((m) => [m.id, m.name]));
    const customerOfSale = new Map(shareSales.map((s) => [s.id, customers.find((c) => c.id === s.customer_id)?.name ?? null]));
    const partnerName = new Map(partners.map((p) => [p.id, p.name]));

    const rows: CashFlowRow[] = [
      // a profit share paid onto installments moved no money (REVENUE-SHARE-PLAN.md §5.2)
      ...sharePayments.filter((p) => p.method !== 'profit_adjustment').map((p) => ({
        id: p.id,
        account_id: p.account_id ?? null,
        date: p.paid_on,
        amount: money(Number(p.amount) || 0),
        kind: 'share_receipt' as const,
        label: customerOfSale.get(p.sale_id) ?? 'Investor receipt',
        reference: p.reference ?? null,
      })),
      // DIRECT-PURCHASE-PLAN.md B5 — partner capital, loans and other money in
      ...fundIn.map((f) => ({
        id: f.id,
        account_id: f.account_id,
        date: f.receipt_date,
        amount: money(Number(f.amount) || 0),
        kind: 'fund_in' as const,
        label:
          (f.partner_id ? partnerName.get(f.partner_id) : null) ??
          f.source_name ??
          (f.source_type === 'loan' ? 'Loan' : 'Money in'),
        reference: f.reference_no ?? null,
      })),
      // REVENUE-SHARE-PLAN.md R1 — a running project's income and costs
      ...revenueEntries.map((e) => ({
        id: e.id,
        account_id: e.account_id,
        date: e.entry_date,
        amount: e.direction === 'income' ? money(e.amount) : -money(e.amount),
        kind: e.direction === 'income' ? ('revenue_in' as const) : ('revenue_cost' as const),
        label: `${projectName.get(e.project_id) ?? ''} · ${e.head}`,
        reference: e.reference_no ?? e.code,
      })),
      // principal only: the interest is already a running cost entry
      ...loanRepayments
        .filter((r) => r.principal > 0)
        .map((r) => ({
          id: r.id,
          account_id: r.account_id,
          date: r.paid_on,
          amount: -money(r.principal),
          kind: 'loan_repayment' as const,
          label: loanById.get(r.loan_id)?.lender_name ?? r.code,
          reference: r.reference_no ?? r.code,
        })),
      ...withdrawals
        .filter((w) => w.status === 'paid')
        .map((w) => ({
          id: w.id,
          account_id: w.account_id ?? null,
          date: w.paid_on ?? w.requested_on,
          amount: -money(w.amount),
          kind: 'profit_payout' as const,
          label: holderName.get(w.customer_id ?? w.partner_id ?? '') ?? w.code,
          reference: w.reference_no ?? w.code,
        })),
      ...commissionPayouts.map((c) => ({
        id: c.id,
        account_id: c.account_id,
        date: c.paid_on,
        amount: -money(Number(c.net) || 0),
        kind: 'commission_payout' as const,
        label: `Commission · ${memberName.get(c.member_id) ?? c.code}`,
        reference: c.reference_no ?? c.code,
      })),
    ];

    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  async position(): Promise<CashPosition> {
    const [accounts, flows] = await Promise.all([this.list(), this.flows()]);

    const withPosition: AccountWithPosition[] = accounts.map((account) => {
      const { account_id, ...rest } = positionForAccount(
        account.id,
        account.opening_balance,
        account.opening_balance_date,
        flows,
      );
      void account_id;
      return { ...account, ...rest };
    });

    const loose = unattributed(flows);

    return {
      accounts: withPosition,
      total_balance: money(withPosition.reduce((s, a) => s + a.closing_balance, 0)),
      total_in: money(withPosition.reduce((s, a) => s + a.money_in, 0)),
      total_out: money(withPosition.reduce((s, a) => s + a.money_out, 0)),
      unattributed_in: loose.money_in,
      unattributed_out: loose.money_out,
      unattributed_count: loose.count,
    };
  }

  /** One account's statement, newest first. */
  async movements(accountId: string): Promise<CashFlowRow[]> {
    return (await this.flows()).filter((f) => f.account_id === accountId);
  }

  /** Movements recorded with no account — the ones the Cash Position warns about. */
  async unattributedMovements(): Promise<CashFlowRow[]> {
    return (await this.flows()).filter((f) => !f.account_id);
  }

  /**
   * Put a movement recorded without an account onto one, after the fact
   * (client, 2026-10-21). The warning on Cash Position used to say "set the
   * account" with nowhere to do it. Only a share receipt can be missing one;
   * money in, repayments, payouts and cost entries all require it.
   */
  async setAccountOnMovement(kind: CashFlowRow['kind'], id: string, accountId: string): Promise<void> {
    const changes = { account_id: accountId, updated_at: new Date().toISOString() };
    if (kind === 'share_receipt') await db.share_payments.update(id, changes);
    else throw new Error(`A ${kind} always carries its account`);
  }

  /**
   * Deletable only while nothing points at it — the rule suppliers and material
   * items already follow. Closing an account keeps its statement readable.
   */
  async removeIfUnused(id: string): Promise<void> {
    const account = await this.getById(id);
    if (!account) return;

    const [f, sh, cp, re, lr] = await Promise.all([
      db.fund_receipts.where('account_id').equals(id).count(),
      db.share_payments.where('account_id').equals(id).count(),
      db.commission_payouts.where('account_id').equals(id).count(),
      db.revenue_entries.where('account_id').equals(id).count(),
      db.loan_repayments.where('account_id').equals(id).count(),
    ]);
    if (f + sh + cp + re + lr > 0) throw new BankAccountInUseError(account.name);
    await this.remove(id);
  }
}

export const bankAccountRepository = new BankAccountRepository();
