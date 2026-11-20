'use client';

import { api, type Page } from './client';

/**
 * Income, profit periods and what each holder was credited, over the API.
 *
 * The statement figures are never sent — they come back worked out from the
 * entries and the policy. The browser can preview a period with the same
 * `lib/domain/revenue-share.ts` code the server used, but it is the server's
 * sum that is frozen when a period is closed.
 */

export interface ApiRevenuePolicy {
  id: string;
  project_id: string;
  entry_frequency: 'daily' | 'monthly' | 'quarterly';
  distribution_frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
  first_period_start: string;
  reserve_pct: number;
  mgmt_fee_type: 'none' | 'pct_income' | 'pct_profit' | 'fixed';
  mgmt_fee_value: number;
  tax_withholding_pct: number;
  loss_rule: 'recover_first' | 'ignore';
  eligibility_rule: 'fully_paid' | 'pro_rata_paid' | 'all_signed';
  prorate_days: boolean;
  repay_loans_first: boolean;
  min_withdrawal: number;
  withdrawal_window: 'any_time' | 'after_declare' | 'day_of_month';
  withdrawal_window_days: number;
  adjust_overdue_first: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type RevenuePolicyWrite = Partial<
  Omit<ApiRevenuePolicy, 'id' | 'project_id' | 'created_at' | 'updated_at'>
>;

export interface ApiRevenueEntry {
  id: string;
  code: string;
  project_id: string;
  entry_date: string;
  direction: 'income' | 'cost';
  head: string;
  amount: number;
  account_id: string | null;
  reference_no: string | null;
  notes: string | null;
  period_id: string | null;
  /** true once its period is closed: it cannot be changed any more */
  locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface RevenueEntryWrite {
  entry_date: string;
  direction: 'income' | 'cost';
  head: string;
  amount: number;
  account_id?: string | null;
  reference_no?: string | null;
  notes?: string | null;
}

/** The statement, in the order the plan states it (§2.3). */
export interface Statement {
  income: number;
  cost: number;
  operating_profit: number;
  loss_brought_in: number;
  reserve: number;
  mgmt_fee: number;
  loan_principal_due: number;
  available: number;
  loss_carried_out: number;
}

export interface ApiRevenuePeriod extends Statement {
  id: string;
  code: string;
  project_id: string;
  period_start: string;
  period_end: string;
  label: string;
  status: 'closed' | 'approved' | 'declared' | 'cancelled';
  declared: number;
  record_date: string | null;
  approved_on: string | null;
  declared_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A period nobody has closed yet: not a row, just dates and a sum. */
export interface ApiOpenPeriod extends Statement {
  period_start: string;
  period_end: string;
  label: string;
  closable: boolean;
}

export interface PeriodsView {
  policy: ApiRevenuePolicy | null;
  closed: ApiRevenuePeriod[];
  open: ApiOpenPeriod[];
}

export interface ApiProfitAllocation {
  id: string;
  period_id: string;
  project_id: string;
  holder_type: 'customer' | 'partner';
  customer_id: string | null;
  customer_name: string | null;
  share_sale_id: string | null;
  ownership_pct: number;
  eligibility_factor: number;
  gross: number;
  tax_withheld: number;
  adjusted_to_dues: number;
  net_credited: number;
  created_at: string;
}

export interface CustomerEarnings {
  lines: {
    id: string;
    project_id: string;
    project_name: string;
    period_label: string;
    record_date: string | null;
    ownership_pct: number;
    eligibility_factor: number;
    gross: number;
    tax_withheld: number;
    net_credited: number;
  }[];
  totals: { gross: number; tax_withheld: number; credited: number };
}

export const revenueApi = {
  async policy(projectId: string, signal?: AbortSignal): Promise<ApiRevenuePolicy | null> {
    const { policy } = await api.get<{ policy: ApiRevenuePolicy | null }>(
      `/projects/${projectId}/revenue`,
      undefined,
      signal,
    );
    return policy;
  },

  savePolicy(projectId: string, input: RevenuePolicyWrite): Promise<ApiRevenuePolicy> {
    return api.put<ApiRevenuePolicy>(`/projects/${projectId}/revenue`, input);
  },

  entries(
    projectId: string,
    query: { from?: string; to?: string; direction?: string; page_size?: number } = {},
    signal?: AbortSignal,
  ): Promise<Page<ApiRevenueEntry>> {
    return api.list<ApiRevenueEntry>(`/projects/${projectId}/revenue/entries`, { ...query }, signal);
  },

  addEntry(projectId: string, input: RevenueEntryWrite): Promise<ApiRevenueEntry> {
    return api.post<ApiRevenueEntry>(`/projects/${projectId}/revenue/entries`, input);
  },

  removeEntry(entryId: string): Promise<void> {
    return api.del<void>(`/revenue-entries/${entryId}`);
  },

  periods(projectId: string, signal?: AbortSignal): Promise<PeriodsView> {
    return api.get<PeriodsView>(`/projects/${projectId}/revenue/periods`, undefined, signal);
  },

  /** Freezes a period's statement and locks its entries. */
  close(projectId: string, period_start: string): Promise<ApiRevenuePeriod> {
    return api.post<ApiRevenuePeriod>(`/projects/${projectId}/revenue/periods`, { period_start });
  },

  reopen(periodId: string): Promise<void> {
    return api.patch<void>(`/revenue-periods/${periodId}`, { action: 'reopen' });
  },

  /** Accepts the statement and says how much of it will be shared. */
  approve(periodId: string, declared: number): Promise<ApiRevenuePeriod> {
    return api.patch<ApiRevenuePeriod>(`/revenue-periods/${periodId}`, {
      action: 'approve',
      declared,
    });
  },

  /** The point of no return: every holder's share is written and frozen. */
  declare(
    periodId: string,
    record_date?: string,
  ): Promise<{ period: ApiRevenuePeriod; allocations: ApiProfitAllocation[] }> {
    return api.patch<{ period: ApiRevenuePeriod; allocations: ApiProfitAllocation[] }>(
      `/revenue-periods/${periodId}`,
      { action: 'declare', ...(record_date ? { record_date } : {}) },
    );
  },

  allocations(periodId: string, signal?: AbortSignal): Promise<ApiProfitAllocation[]> {
    return api.get<ApiProfitAllocation[]>(`/revenue-periods/${periodId}`, undefined, signal);
  },

  earnings(customerId: string, signal?: AbortSignal): Promise<CustomerEarnings> {
    return api.get<CustomerEarnings>(`/customers/${customerId}/earnings`, undefined, signal);
  },
};

export const revenueKeys = {
  all: ['revenue'] as const,
  policy: (projectId: string) => ['revenue', 'policy', projectId] as const,
  entries: (projectId: string, query: object = {}) =>
    ['revenue', 'entries', projectId, query] as const,
  periods: (projectId: string) => ['revenue', 'periods', projectId] as const,
  allocations: (periodId: string) => ['revenue', 'allocations', periodId] as const,
  earnings: (customerId: string) => ['revenue', 'earnings', customerId] as const,
};
