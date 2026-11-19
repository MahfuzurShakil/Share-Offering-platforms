'use client';

import { api, type Page } from './client';

/**
 * Customers (investors), over the API.
 *
 * One record per person across every project they buy into, which is why the
 * phone lookup is here: the form asks it while somebody types, so an investor
 * already on file is found before a second record is made for them.
 */

export interface CustomerHoldings {
  purchases: number;
  shares: number;
  value: number;
  paid: number;
  due: number;
}

export interface ApiCustomer {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  customer_type: string;
  lead_id: string | null;
  nid: string | null;
  tin: string | null;
  date_of_birth: string | null;
  father_or_spouse_name: string | null;
  profession: string | null;
  address: string | null;
  permanent_address: string | null;
  kyc_verified_on: string | null;
  nominee_name: string | null;
  nominee_relation: string | null;
  nominee_phone: string | null;
  nominee_nid: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  /** what they hold across every project, counted by the database */
  holdings: CustomerHoldings;
}

export type CustomerWrite = Partial<
  Pick<
    ApiCustomer,
    | 'name'
    | 'phone'
    | 'email'
    | 'lead_id'
    | 'nid'
    | 'tin'
    | 'date_of_birth'
    | 'father_or_spouse_name'
    | 'profession'
    | 'address'
    | 'permanent_address'
    | 'kyc_verified_on'
    | 'nominee_name'
    | 'nominee_relation'
    | 'nominee_phone'
    | 'nominee_nid'
    | 'bank_name'
    | 'bank_branch'
    | 'bank_account'
  >
>;

export interface CustomerQuery {
  name?: string;
  phone?: string;
  nid?: string;
  profession?: string;
  holding_state?: 'any' | 'none' | 'active' | 'signed';
  sort?: 'newest' | 'oldest' | 'name';
  page?: number;
  page_size?: number;
}

export const customersApi = {
  page(query: CustomerQuery = {}, signal?: AbortSignal): Promise<Page<ApiCustomer>> {
    return api.list<ApiCustomer>('/customers', { ...query }, signal);
  },

  async list(query: CustomerQuery = {}, signal?: AbortSignal): Promise<ApiCustomer[]> {
    return (await customersApi.page(query, signal)).rows;
  },

  get(id: string, signal?: AbortSignal): Promise<ApiCustomer> {
    return api.get<ApiCustomer>(`/customers/${id}`, undefined, signal);
  },

  /** Who already has this number, if anybody. */
  async byPhone(phone: string, signal?: AbortSignal): Promise<ApiCustomer | null> {
    const { customer } = await api.get<{ customer: ApiCustomer | null }>(
      '/customers',
      { by_phone: phone },
      signal,
    );
    return customer;
  },

  create(input: CustomerWrite & { name: string; phone: string }): Promise<ApiCustomer> {
    return api.post<ApiCustomer>('/customers', input);
  },

  update(id: string, input: CustomerWrite): Promise<ApiCustomer> {
    return api.patch<ApiCustomer>(`/customers/${id}`, input);
  },

  remove(id: string): Promise<void> {
    return api.del<void>(`/customers/${id}`);
  },
};

export const customerKeys = {
  all: ['customers'] as const,
  list: (query: CustomerQuery) => ['customers', 'list', query] as const,
  one: (id: string) => ['customers', 'one', id] as const,
  byPhone: (phone: string) => ['customers', 'by-phone', phone] as const,
};
