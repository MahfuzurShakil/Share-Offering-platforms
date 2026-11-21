'use client';

import { api } from './client';

/**
 * Accounts and partners — the first half of the Money module.
 *
 * Only the reads the moved screens need are here: the account picker on a
 * receipt and a payout, and the partner picker on a sales-team member. The
 * Money screens themselves (Fund, Loans, Cash Position) are still on the
 * interim layer, and their writes join this file when they move.
 */

export type BankAccountType = 'bank' | 'cash' | 'mfs';

export interface ApiBankAccount {
  id: string;
  code: string;
  name: string;
  type: BankAccountType;
  bank_name: string | null;
  account_number: string | null;
  branch: string | null;
  opening_balance: number;
  opening_balance_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** what has been paid out of it that this product knows about */
  paid_out: number;
}

export interface ApiPartner {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  nid: string | null;
  /** of the company, or of `project_id` where that is set */
  share_pct: number;
  project_id: string | null;
  project_name: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const accountsApi = {
  list(query: { is_active?: boolean } = {}, signal?: AbortSignal) {
    return api.get<ApiBankAccount[]>('/accounts', { ...query }, signal);
  },
};

export const partnersApi = {
  list(
    query: { is_active?: boolean; project_id?: string; company_only?: boolean } = {},
    signal?: AbortSignal,
  ) {
    return api.get<ApiPartner[]>('/partners', { ...query }, signal);
  },
};

export const accountKeys = {
  all: ['accounts'] as const,
  list: (query: object = {}) => ['accounts', 'list', query] as const,
};

export const partnerKeys = {
  all: ['partners'] as const,
  list: (query: object = {}) => ['partners', 'list', query] as const,
};
