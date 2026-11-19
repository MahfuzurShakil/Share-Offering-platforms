'use client';

import type {
  LateFeeType,
  ShareFrequency,
  ShareOfferingStatus,
} from '@/lib/db/types';
import { api, type Page } from './client';

/**
 * Share offerings, over the API.
 *
 * The round's own arithmetic is not sent: `valuation`, `share_pct` and
 * `price_per_share` come back from the server, which computed them from the
 * valuation. The form still shows them live while somebody types, because the
 * same `offeringMath` runs in the browser — it just does not get to decide
 * them (PROJECT-SHARE-SALE-PLAN.md §4 step 2).
 */

export interface ApiShareOffering {
  id: string;
  code: string;
  project_id: string;
  project_code: string;
  project_name: string;
  round_no: number;
  net_asset_value: number;
  premium_value: number;
  valuation: number;
  valuation_date: string;
  offered_pct: number;
  total_shares: number;
  share_pct: number;
  price_per_share: number;
  validity_days: number;
  opens_on: string | null;
  closes_on: string | null;
  min_shares: number;
  max_shares: number | null;
  min_down_payment_pct: number;
  max_installments: number;
  installment_frequency: ShareFrequency;
  late_fee_type: LateFeeType;
  late_fee_pct: number;
  late_fee_amount: number | null;
  grace_days: number;
  hold_days: number;
  status: ShareOfferingStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** counted by the database from the purchases in this round */
  sold_shares: number;
  reserved_shares: number;
  available_shares: number;
  raised: number;
}

/** The terms a person sets. Everything else the round earns or is given. */
export interface ShareOfferingWrite {
  project_id: string;
  net_asset_value: number;
  premium_value: number;
  valuation_date: string;
  offered_pct: number;
  total_shares: number;
  validity_days?: number;
  closes_on?: string | null;
  min_shares: number;
  max_shares: number;
  min_down_payment_pct: number;
  max_installments: number;
  installment_frequency: ShareFrequency;
  late_fee_type: LateFeeType;
  late_fee_pct: number;
  late_fee_amount?: number | null;
  grace_days: number;
  hold_days: number;
  notes?: string | null;
}

export interface ShareOfferingQuery {
  project_id?: string;
  status?: ShareOfferingStatus;
  search?: string;
  page?: number;
  page_size?: number;
}

export const shareOfferingsApi = {
  page(query: ShareOfferingQuery = {}, signal?: AbortSignal): Promise<Page<ApiShareOffering>> {
    return api.list<ApiShareOffering>('/share-offerings', { ...query }, signal);
  },

  async list(query: ShareOfferingQuery = {}, signal?: AbortSignal): Promise<ApiShareOffering[]> {
    return (await shareOfferingsApi.page(query, signal)).rows;
  },

  get(id: string, signal?: AbortSignal): Promise<ApiShareOffering> {
    return api.get<ApiShareOffering>(`/share-offerings/${id}`, undefined, signal);
  },

  /**
   * How much of a project is still free to offer — what the form has to know
   * before it can let a percentage be typed, because the project's other
   * rounds have already promised some of it.
   */
  async freePct(project_id: string, except?: string, signal?: AbortSignal): Promise<number> {
    const { free_pct } = await api.get<{ free_pct: number }>(
      '/share-offerings',
      { free_for_project: project_id, except },
      signal,
    );
    return free_pct;
  },

  create(input: ShareOfferingWrite): Promise<ApiShareOffering> {
    return api.post<ApiShareOffering>('/share-offerings', input);
  },

  update(id: string, input: ShareOfferingWrite): Promise<ApiShareOffering> {
    return api.patch<ApiShareOffering>(`/share-offerings/${id}`, input);
  },

  /** Puts a draft on the market. */
  open(id: string, dates: { opens_on?: string; closes_on?: string } = {}): Promise<ApiShareOffering> {
    return api.post<ApiShareOffering>(`/share-offerings/${id}/open`, dates);
  },

  /** Runs an open round longer. */
  extend(id: string, extra_days: number): Promise<ApiShareOffering> {
    return api.post<ApiShareOffering>(`/share-offerings/${id}/extend`, { extra_days });
  },

  close(id: string): Promise<ApiShareOffering> {
    return api.patch<ApiShareOffering>(`/share-offerings/${id}`, { status: 'closed' });
  },

  cancel(id: string): Promise<ApiShareOffering> {
    return api.patch<ApiShareOffering>(`/share-offerings/${id}`, { status: 'cancelled' });
  },

  /** A draft only. A round that has been on the market is closed instead. */
  remove(id: string): Promise<void> {
    return api.del<void>(`/share-offerings/${id}`);
  },
};

export const shareOfferingKeys = {
  all: ['share-offerings'] as const,
  list: (query: ShareOfferingQuery) => ['share-offerings', 'list', query] as const,
  one: (id: string) => ['share-offerings', 'one', id] as const,
  free: (project_id: string, except?: string) =>
    ['share-offerings', 'free', project_id, except ?? null] as const,
};
