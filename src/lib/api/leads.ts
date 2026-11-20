'use client';

import type { LeadActivityType, LeadSource, LeadStatus } from '@/lib/db/types';
import { api, type Page } from './client';

/**
 * Leads, over the API.
 *
 * Every row arrives ready to show: how much has been logged on it, when it was
 * last touched, when it is next due, and the names of the project and the
 * person who owns it. The browser used to work all four out by reading the
 * whole activity table — that is what moved to Postgres.
 *
 * The method names are the ones the screens already called on
 * `leadRepository`, so a screen changes by a line rather than being rewritten.
 */

export interface ApiLead {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  status: LeadStatus;
  inquiry_message: string | null;
  interested_project_id: string | null;
  budget_range: string | null;
  assigned_to: string | null;
  lost_reason: string | null;
  page_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_at: string;
  updated_at: string;

  /** counted by the database, not by the browser */
  activity_count: number;
  last_activity_at: string | null;
  /** the open follow-up date, or null once the lead is booked or lost */
  next_follow_up: string | null;
  assignee_name: string | null;
  project_name: string | null;
  project_code: string | null;
}

export interface ApiLeadActivity {
  id: string;
  lead_id: string;
  activity_type: LeadActivityType;
  notes: string;
  activity_date: string;
  next_follow_up_date: string | null;
  /** what a completed stage recorded, label → value */
  details: Record<string, string> | null;
  created_at: string;
}

export interface ApiLeadDetail extends ApiLead {
  activities: ApiLeadActivity[];
  assignee: { id: string; name: string; phone: string } | null;
  project: { id: string; code: string; name: string; location_summary: string | null } | null;
  /** the investor made from this lead, if one was */
  customer: { id: string; code: string; name: string } | null;
  purchases: Array<{ id: string; code: string; status: string; shares: number }>;
}

export interface ApiLeadSummary {
  overdue: number;
  due_today: number;
  unassigned: number;
  by_status: Record<string, number>;
  total: number;
}

export type LeadWrite = Partial<
  Pick<
    ApiLead,
    | 'name'
    | 'phone'
    | 'email'
    | 'source'
    | 'inquiry_message'
    | 'interested_project_id'
    | 'budget_range'
    | 'assigned_to'
    | 'page_url'
    | 'utm_source'
    | 'utm_medium'
    | 'utm_campaign'
  >
>;

export interface LeadQuery {
  search?: string;
  status?: LeadStatus | 'all';
  source?: LeadSource | 'all';
  assigned_to?: string | 'all' | 'unassigned';
  interested_project_id?: string;
  follow_up?: 'overdue' | 'today' | 'all';
  sort?: 'newest' | 'oldest' | 'name' | 'follow_up';
  page?: number;
  page_size?: number;
  /** the browser's own day, so "overdue" means overdue where the person is */
  today?: string;
}

export interface StageCompletion {
  to: LeadStatus;
  activity_type: LeadActivityType;
  event_date: string;
  title: string;
  details?: Record<string, string>;
  notes?: string;
  next_follow_up_date?: string | null;
  updates?: { budget_range?: string | null; interested_project_id?: string | null };
}

export interface ActivityWrite {
  activity_type: LeadActivityType;
  notes: string;
  activity_date?: string;
  next_follow_up_date?: string | null;
}

export interface CapturedInquiry {
  /** true when an existing lead absorbed the inquiry instead of a new row */
  merged: boolean;
  lead: ApiLead;
}

export interface LeadConversion {
  /** true when the lead was already on file as an investor */
  existing: boolean;
  customer: { id: string; code: string; name: string; phone: string };
  lead: ApiLead;
}

export const leadsApi = {
  page(query: LeadQuery = {}, signal?: AbortSignal): Promise<Page<ApiLead>> {
    return api.list<ApiLead>('/leads', { ...query }, signal);
  },

  async list(query: LeadQuery = {}, signal?: AbortSignal): Promise<ApiLead[]> {
    return (await leadsApi.page(query, signal)).rows;
  },

  get(id: string, signal?: AbortSignal): Promise<ApiLeadDetail> {
    return api.get<ApiLeadDetail>(`/leads/${id}`, undefined, signal);
  },

  /** Whose lead this number already is, if anybody's — the dedup warning. */
  async byPhone(phone: string, signal?: AbortSignal): Promise<ApiLead | null> {
    const { lead } = await api.get<{ lead: ApiLead | null }>(
      '/leads',
      { by_phone: phone },
      signal,
    );
    return lead;
  },

  /** What the desk owes today, and how the pipeline is spread. */
  summary(today?: string, signal?: AbortSignal): Promise<ApiLeadSummary> {
    return api.get<ApiLeadSummary>('/leads/summary', { today }, signal);
  },

  /** Who has to be called, soonest first. */
  queue(
    today?: string,
    signal?: AbortSignal,
  ): Promise<Array<{ lead: ApiLead; date: string }>> {
    return api.get<Array<{ lead: ApiLead; date: string }>>('/leads/queue', { today }, signal);
  },

  /**
   * A new inquiry — from this form or, later, from the public website.
   *
   * `merged` says what happened: a repeat caller's inquiry lands on their
   * existing lead instead of opening a second one.
   */
  capture(
    input: LeadWrite & { name: string; phone: string; source: LeadSource },
  ): Promise<CapturedInquiry> {
    return api.post<CapturedInquiry>('/leads', input);
  },

  update(id: string, input: LeadWrite): Promise<ApiLead> {
    return api.patch<ApiLead>(`/leads/${id}`, input);
  },

  /** Marks it lost, or revives it to an earlier stage. Both are logged. */
  setStatus(
    id: string,
    status: LeadStatus,
    options: { notes?: string; next_follow_up_date?: string | null } = {},
  ): Promise<ApiLead> {
    return api.post<ApiLead>(`/leads/${id}/status`, { status, ...options });
  },

  /** Completes the stage the lead is in (`domain/lead-stages.ts`). */
  completeStage(id: string, input: StageCompletion): Promise<ApiLead> {
    return api.post<ApiLead>(`/leads/${id}/stage`, input);
  },

  assign(id: string, assigned_to: string | null): Promise<ApiLead> {
    return api.put<ApiLead>(`/leads/${id}/assignment`, { assigned_to });
  },

  activities(id: string, signal?: AbortSignal): Promise<ApiLeadActivity[]> {
    return api.get<ApiLeadActivity[]>(`/leads/${id}/activities`, undefined, signal);
  },

  log(id: string, input: ActivityWrite): Promise<ApiLeadActivity> {
    return api.post<ApiLeadActivity>(`/leads/${id}/activities`, input);
  },

  /** Opens the investor file from the lead, or links the one already on file. */
  convert(
    id: string,
    input: { name?: string; email?: string | null } = {},
  ): Promise<LeadConversion> {
    return api.post<LeadConversion>(`/leads/${id}/convert`, input);
  },

  remove(id: string): Promise<void> {
    return api.del<void>(`/leads/${id}`);
  },
};

export const leadKeys = {
  all: ['leads'] as const,
  list: (query: LeadQuery) => ['leads', 'list', query] as const,
  one: (id: string) => ['leads', 'one', id] as const,
  summary: (today: string) => ['leads', 'summary', today] as const,
  queue: (today: string) => ['leads', 'queue', today] as const,
  byPhone: (phone: string) => ['leads', 'by-phone', phone] as const,
};

/* ------------------------------------------------------------------ *
 * The assignee picker
 * ------------------------------------------------------------------ */

export interface SalesTeamMember {
  id: string;
  name: string;
  role_code: string;
}

/**
 * Who a lead can be handed to. Its own small endpoint rather than the user
 * list: the picker needs names, not the staff directory.
 */
export const salesTeamApi = {
  list(signal?: AbortSignal): Promise<SalesTeamMember[]> {
    return api.get<SalesTeamMember[]>('/users/sales-team', undefined, signal);
  },
};

export const salesTeamKeys = { all: ['users', 'sales-team'] as const };
