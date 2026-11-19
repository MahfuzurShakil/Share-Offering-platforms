'use client';

import type {
  LandSizeUnit,
  ProjectSalesStatus,
  ProjectStatus,
  ProjectType,
} from '@/lib/db/types';
import { api, type Page } from './client';

/**
 * Projects, over the API.
 *
 * The method names are the ones the screens already called on
 * `projectRepository` — `list`, `get`, `create`, `update`, `remove`,
 * `setSalesStatus` — so a screen changes by its import and its hook, not by its
 * logic. What changed underneath: the filtering, sorting, paging and the
 * uniqueness check all happen on the server, which is the only place they can
 * be trusted.
 */

/** A project as the server sends it. Dates are `YYYY-MM-DD`, money a number. */
export interface ApiProject {
  id: string;
  code: string;
  name: string;
  project_type: ProjectType;
  status: ProjectStatus;
  sales_status: ProjectSalesStatus;
  total_land_area: number | null;
  total_land_area_unit: LandSizeUnit | null;
  description: string | null;
  location_summary: string | null;
  /** what 100% of the project is worth, and into how many shares it is cut */
  valuation: number | null;
  total_shares: number | null;
  valuation_date: string | null;
  /** 100 / total_shares — what one share of this project owns */
  share_pct: number | null;
  shares_offered: number;
  shares_free: number | null;
  /** true once a round has been on the market: the valuation is fixed */
  valuation_locked: boolean;
  expected_start_date: string | null;
  expected_completion_date: string | null;
  project_manager_id: string | null;
  project_manager_name: string | null;
  architect: string | null;
  surroundings: string | null;
  amenities: string[];
  cover_image_url: string | null;
  cover_image_document_id: string | null;
  construction_after_sale: 'undecided' | 'planned' | 'none';
  default_late_fee_pct: number | null;
  default_late_fee_grace_days: number | null;
  is_public: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectQuery {
  search?: string;
  status?: ProjectStatus;
  project_type?: ProjectType;
  sales_status?: ProjectSalesStatus;
  is_public?: boolean;
  sort?: 'newest' | 'oldest' | 'completion_soon' | 'name';
  page?: number;
  page_size?: number;
}

/** Everything a person may set. Anything left out is left alone. */
export type ProjectWrite = Partial<
  Pick<
    ApiProject,
    | 'name'
    | 'description'
    | 'valuation'
    | 'total_shares'
    | 'valuation_date'
    | 'project_type'
    | 'status'
    | 'total_land_area'
    | 'total_land_area_unit'
    | 'location_summary'
    | 'expected_start_date'
    | 'expected_completion_date'
    | 'project_manager_id'
    | 'architect'
    | 'surroundings'
    | 'amenities'
    | 'cover_image_url'
    | 'cover_image_document_id'
    | 'construction_after_sale'
    | 'default_late_fee_pct'
    | 'default_late_fee_grace_days'
    | 'is_public'
    | 'is_featured'
  >
>;

export const projectsApi = {
  /** A page of projects, with the total so a pager can be drawn. */
  page(query: ProjectQuery = {}, signal?: AbortSignal): Promise<Page<ApiProject>> {
    return api.list<ApiProject>('/projects', { ...query }, signal);
  },

  /** Just the rows, for a screen that does its own paging in the browser. */
  async list(query: ProjectQuery = {}, signal?: AbortSignal): Promise<ApiProject[]> {
    return (await projectsApi.page(query, signal)).rows;
  },

  get(id: string, signal?: AbortSignal): Promise<ApiProject> {
    return api.get<ApiProject>(`/projects/${id}`, undefined, signal);
  },

  create(input: ProjectWrite & { name: string }): Promise<ApiProject> {
    return api.post<ApiProject>('/projects', input);
  },

  update(id: string, input: ProjectWrite): Promise<ApiProject> {
    return api.patch<ApiProject>(`/projects/${id}`, input);
  },

  /** Opening, pausing and closing sales — its own move, with its own rules. */
  setSalesStatus(id: string, sales_status: ProjectSalesStatus): Promise<ApiProject> {
    return api.patch<ApiProject>(`/projects/${id}/sales-status`, { sales_status });
  },

  remove(id: string): Promise<void> {
    return api.del<void>(`/projects/${id}`);
  },
};

/** The query keys, in one place so an invalidation cannot miss a screen. */
export const projectKeys = {
  all: ['projects'] as const,
  list: (query: ProjectQuery) => ['projects', 'list', query] as const,
  one: (id: string) => ['projects', 'one', id] as const,
};

/* ------------------------------------------------------------------ *
 * The manager picker
 * ------------------------------------------------------------------ */

export interface AssignableUser {
  id: string;
  name: string;
  role_code: string;
}

/**
 * Who a project can be handed to. Its own small endpoint rather than the user
 * list: the project form needs names, not the staff directory.
 */
export const assignableUsersApi = {
  list(signal?: AbortSignal): Promise<AssignableUser[]> {
    return api.get<AssignableUser[]>('/users/assignable', undefined, signal);
  },
};

export const assignableUserKeys = { all: ['users', 'assignable'] as const };
