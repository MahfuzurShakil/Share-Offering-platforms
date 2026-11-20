'use client';

import type { SharePaymentMethod, ShareSaleStatus } from '@/lib/db/types';
import { api, type Page } from './client';

/**
 * Share purchases, over the API.
 *
 * What comes back is the purchase *and* what its schedule says: every
 * installment with what it is owed and whether it is late, every receipt, and
 * the totals. The server works those out with the same `lib/domain` code the
 * browser uses to preview them, so a screen never has to add money up itself.
 */

export interface ApiScheduleRow {
  id: string;
  seq: number;
  label: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  remaining: number;
  status: 'paid' | 'due' | 'overdue' | 'upcoming';
  days_late: number;
  late_fee_due: number;
  late_fee_paid: number;
}

export interface ApiReceipt {
  id: string;
  code: string;
  paid_on: string;
  amount: number;
  principal: number;
  late_fee: number;
  method: SharePaymentMethod;
  reference: string | null;
  channel: 'office' | 'online';
  notes: string | null;
  /** set on a reversing receipt: the one it cancels */
  reverses_payment_id: string | null;
}

export interface ApiShareSale {
  id: string;
  code: string;
  offering_id: string;
  offering_code: string;
  round_no: number;
  project_id: string;
  project_name: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  shares: number;
  share_pct: number;
  price_per_share: number;
  total_price: number;
  down_payment: number;
  installment_count: number;
  installment_frequency: 'monthly' | 'quarterly';
  reserved_on: string;
  hold_until: string;
  agreement_no: string | null;
  agreement_date: string | null;
  first_due_date: string | null;
  certificate_no: string | null;
  certificate_date: string | null;
  status: ShareSaleStatus;
  status_note: string | null;
  notes: string | null;
  signing: unknown;
  created_at: string;
  updated_at: string;

  paid: number;
  outstanding: number;
  overdue_amount: number;
  late_fees: number;
  due_now: number;
  progress_pct: number;
  paid_count: number;
  health: 'reserved' | 'hold_expired' | 'paying' | 'overdue' | 'fully_paid' | 'certified' | 'released' | 'cancelled';
  next_due_date: string | null;
  schedule: ApiScheduleRow[];
  payments: ApiReceipt[];
}

export interface ShareSaleQuery {
  offering_id?: string;
  project_id?: string;
  customer_id?: string;
  status?: ShareSaleStatus;
  search?: string;
  overdue?: boolean;
  page?: number;
  page_size?: number;
}

export interface ReserveInput {
  offering_id: string;
  customer_id: string;
  shares: number;
  down_payment_pct: number;
  installment_count: number;
  reserved_on?: string;
  notes?: string | null;
  sold_by_member_id?: string | null;
}

export interface SignInput {
  agreement_date: string;
  first_due_date?: string | null;
  terms?: { shares: number; down_payment_pct: number; installment_count: number } | null;
  signing?: Record<string, unknown> | null;
}

export interface PaymentInput {
  paid_on: string;
  amount: number;
  method: SharePaymentMethod;
  reference?: string | null;
  notes?: string | null;
  method_detail?: string | null;
  account_id?: string | null;
}

export const shareSalesApi = {
  page(query: ShareSaleQuery = {}, signal?: AbortSignal): Promise<Page<ApiShareSale>> {
    return api.list<ApiShareSale>('/share-sales', { ...query }, signal);
  },

  async list(query: ShareSaleQuery = {}, signal?: AbortSignal): Promise<ApiShareSale[]> {
    return (await shareSalesApi.page(query, signal)).rows;
  },

  get(id: string, signal?: AbortSignal): Promise<ApiShareSale> {
    return api.get<ApiShareSale>(`/share-sales/${id}`, undefined, signal);
  },

  /** Holds shares for an investor while the agreement is prepared. */
  reserve(input: ReserveInput): Promise<ApiShareSale> {
    return api.post<ApiShareSale>('/share-sales', input);
  },

  /** Fixes the plan, numbers the agreement and writes the schedule. */
  sign(id: string, input: SignInput): Promise<ApiShareSale> {
    return api.post<ApiShareSale>(`/share-sales/${id}/sign`, input);
  },

  release(id: string, note: string): Promise<ApiShareSale> {
    return api.patch<ApiShareSale>(`/share-sales/${id}/status`, { status: 'released', note });
  },

  cancel(id: string, note: string): Promise<ApiShareSale> {
    return api.patch<ApiShareSale>(`/share-sales/${id}/status`, { status: 'cancelled', note });
  },

  /** Money in. The server decides how it is spread over the schedule. */
  pay(id: string, input: PaymentInput): Promise<ApiShareSale> {
    return api.post<ApiShareSale>(`/share-sales/${id}/payments`, input);
  },

  /** Corrects a receipt by writing its opposite. */
  reverse(id: string, payment_id: string, reason: string): Promise<ApiShareSale> {
    return api.patch<ApiShareSale>(`/share-sales/${id}/payments`, { payment_id, reason });
  },
};

export const shareSaleKeys = {
  all: ['share-sales'] as const,
  list: (query: ShareSaleQuery) => ['share-sales', 'list', query] as const,
  one: (id: string) => ['share-sales', 'one', id] as const,
};
