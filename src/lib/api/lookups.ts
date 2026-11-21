'use client';

import { api } from './client';

/**
 * The option lists the client edits themselves — amenities, document types,
 * income and expense heads, designations.
 *
 * One client for all of them, because they all come from the same route and a
 * screen only ever wants "the options for this category, in the client's own
 * order". The designation picker in `sales-team.ts` predates this and reads
 * the same route.
 */

export type LookupCategory =
  | 'amenity'
  | 'document_type'
  | 'profession'
  | 'budget_range'
  | 'revenue_income_head'
  | 'revenue_expense_head'
  | 'land_size_unit'
  | 'org_designation';

export interface ApiLookup {
  id: string;
  category: string;
  scope: string | null;
  value: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
  /** a seeded row the client may rename but not delete */
  is_system: boolean;
}

export const lookupsApi = {
  options(category: LookupCategory, scope?: string | null, signal?: AbortSignal) {
    return api.get<ApiLookup[]>('/lookups', { category, scope: scope ?? undefined }, signal);
  },
};

export const lookupKeys = {
  all: ['lookups'] as const,
  category: (category: LookupCategory, scope?: string | null) =>
    ['lookups', category, scope ?? null] as const,
};
