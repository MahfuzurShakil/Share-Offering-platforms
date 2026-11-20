'use client';

import type {
  CommissionBasis,
  CommissionLineStatus,
  CommissionOverride,
  CommissionPlanStatus,
  CommissionStage,
  OrgMemberStatus,
} from '@/lib/db/types';
import { api, type Page } from './client';

/**
 * The sales organisation and its commission, over the API.
 *
 * The node shape the org chart reads is kept exactly: `n.member.name`,
 * `n.designation`, `n.branch_sales`. The screens changed by a line each, which
 * is what the typed client is for.
 *
 * Reading the commissions reconciles them with the payment ledgers first, so a
 * stage the money has reached is already `earned` by the time it is drawn —
 * nothing on these screens marks a stage by hand.
 */

export interface ApiOrgMember {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  designation_id: string;
  designation: string;
  /** the designation's place in the list: 1 = the top */
  rank: number;
  parent_id: string | null;
  parent_name: string | null;
  user_id: string | null;
  user_name: string | null;
  partner_id: string | null;
  joined_on: string;
  left_on: string | null;
  status: OrgMemberStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;

  own_sales: number;
  own_sales_count: number;
  /** everybody under them, at any depth */
  team_size: number;
  branch_sales: number;
  branch_sales_count: number;
}

/** The tree. The member is nested as well, which is how the chart reads it. */
export interface ApiOrgNode extends ApiOrgMember {
  member: ApiOrgMember;
  partner_name: string | null;
  children: ApiOrgNode[];
}

export interface ApiOrgMove {
  id: string;
  member_id: string;
  from_parent_id: string | null;
  from_parent_name: string | null;
  to_parent_id: string | null;
  to_parent_name: string | null;
  effective_date: string;
  note: string | null;
  created_at: string;
}

export type MemberWrite = Partial<
  Pick<
    ApiOrgMember,
    'name' | 'phone' | 'designation_id' | 'user_id' | 'partner_id' | 'joined_on' | 'notes'
  >
> & {
  /** only on create: afterwards a reporting line changes through `move` */
  parent_id?: string | null;
};

export interface MemberQuery {
  designation_id?: string;
  status?: OrgMemberStatus | 'all';
  search?: string;
}

export const orgMembersApi = {
  list(query: MemberQuery = {}, signal?: AbortSignal): Promise<ApiOrgMember[]> {
    return api.get<ApiOrgMember[]>('/org-members', { ...query }, signal);
  },

  tree(signal?: AbortSignal): Promise<ApiOrgNode[]> {
    return api.get<ApiOrgNode[]>('/org-members/tree', undefined, signal);
  },

  get(id: string, signal?: AbortSignal): Promise<ApiOrgMember> {
    return api.get<ApiOrgMember>(`/org-members/${id}`, undefined, signal);
  },

  create(
    input: MemberWrite & { name: string; designation_id: string; joined_on: string },
  ): Promise<ApiOrgMember> {
    return api.post<ApiOrgMember>('/org-members', input);
  },

  /** Their own details. Who they report to goes through `move`. */
  update(id: string, input: Omit<MemberWrite, 'parent_id'>): Promise<ApiOrgMember> {
    return api.patch<ApiOrgMember>(`/org-members/${id}`, input);
  },

  /**
   * Puts them under somebody else from a date, with their whole team.
   *
   * The date is the point of it: commission on a sale is read from the tree as
   * it was that day, so an old override stays where it was earned.
   */
  move(
    id: string,
    input: { to_parent_id: string | null; effective_date: string; note?: string | null },
  ): Promise<ApiOrgMember> {
    return api.post<ApiOrgMember>(`/org-members/${id}/move`, input);
  },

  markLeft(id: string, left_on: string): Promise<ApiOrgMember> {
    return api.patch<ApiOrgMember>(`/org-members/${id}/status`, { status: 'left', left_on });
  },

  rejoin(id: string): Promise<ApiOrgMember> {
    return api.patch<ApiOrgMember>(`/org-members/${id}/status`, { status: 'active' });
  },

  history(id: string, signal?: AbortSignal): Promise<ApiOrgMove[]> {
    return api.get<ApiOrgMove[]>(`/org-members/${id}/history`, undefined, signal);
  },

  statement(id: string, signal?: AbortSignal): Promise<ApiMemberStatement> {
    return api.get<ApiMemberStatement>(`/org-members/${id}/statement`, undefined, signal);
  },

  remove(id: string): Promise<void> {
    return api.del<void>(`/org-members/${id}`);
  },
};

export const orgKeys = {
  all: ['org-members'] as const,
  list: (query: MemberQuery) => ['org-members', 'list', query] as const,
  tree: () => ['org-members', 'tree'] as const,
  one: (id: string) => ['org-members', 'one', id] as const,
  history: (id: string) => ['org-members', 'history', id] as const,
  statement: (id: string) => ['org-members', 'statement', id] as const,
};

/* ------------------------------------------------------------------ *
 * Plans
 * ------------------------------------------------------------------ */

export interface ApiCommissionPlan {
  id: string;
  code: string;
  name: string;
  applies_to: 'share_sale' | 'booking';
  project_id: string | null;
  project_name: string | null;
  offering_id: string | null;
  offering_code: string | null;
  seller_basis: CommissionBasis;
  seller_value: number;
  stages: CommissionStage[];
  overrides: CommissionOverride[];
  cancel_rule: 'recover' | 'write_off';
  effective_from: string;
  effective_to: string | null;
  status: CommissionPlanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** lines built from this plan — any at all and its terms are frozen */
  sales: number;
}

export type PlanWrite = Partial<
  Pick<
    ApiCommissionPlan,
    | 'name'
    | 'applies_to'
    | 'project_id'
    | 'offering_id'
    | 'seller_basis'
    | 'seller_value'
    | 'stages'
    | 'overrides'
    | 'cancel_rule'
    | 'effective_from'
    | 'effective_to'
    | 'status'
    | 'notes'
  >
>;

export const commissionPlansApi = {
  list(signal?: AbortSignal): Promise<ApiCommissionPlan[]> {
    return api.get<ApiCommissionPlan[]>('/commission-plans', undefined, signal);
  },

  get(id: string, signal?: AbortSignal): Promise<ApiCommissionPlan> {
    return api.get<ApiCommissionPlan>(`/commission-plans/${id}`, undefined, signal);
  },

  create(input: PlanWrite & { name: string; effective_from: string }): Promise<ApiCommissionPlan> {
    return api.post<ApiCommissionPlan>('/commission-plans', input);
  },

  /** Only the name, notes, end date and status once anything has earned. */
  update(id: string, input: PlanWrite): Promise<ApiCommissionPlan> {
    return api.patch<ApiCommissionPlan>(`/commission-plans/${id}`, input);
  },

  remove(id: string): Promise<void> {
    return api.del<void>(`/commission-plans/${id}`);
  },
};

export const planKeys = {
  all: ['commission-plans'] as const,
  list: () => ['commission-plans', 'list'] as const,
  one: (id: string) => ['commission-plans', 'one', id] as const,
};

/* ------------------------------------------------------------------ *
 * Lines, statements and payouts
 * ------------------------------------------------------------------ */

export interface ApiCommissionLine {
  id: string;
  plan_id: string;
  plan_code: string;
  sale_kind: 'share' | 'booking';
  share_sale_id: string | null;
  sale_code: string;
  project_id: string | null;
  project_name: string | null;
  customer_name: string | null;
  member_id: string;
  member_name: string;
  member_code: string;
  role: 'seller' | 'override';
  /** the designation's label when the line was made, not today's */
  designation_at_sale: string;
  level: number;
  stage_key: string;
  stage_label: string;
  stage_seq: number;
  sale_date: string;
  sale_amount: number;
  amount: number;
  status: CommissionLineStatus;
  earned_on: string | null;
  approved_on: string | null;
  payout_id: string | null;
  /** paid commission on a cancelled sale, waiting to come off a payout */
  to_recover: boolean;
  recovered_payout_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface ApiCommissionTotals {
  pending: number;
  earned: number;
  approved: number;
  paid: number;
  void: number;
  recovered: number;
  to_recover: number;
}

export interface ApiStatementSale {
  key: string;
  share_sale_id: string | null;
  sale_code: string;
  sale_date: string;
  sale_amount: number;
  customer_name: string | null;
  project_name: string | null;
  role: 'seller' | 'override';
  designation_at_sale: string;
  lines: ApiCommissionLine[];
  totals: ApiCommissionTotals;
  total: number;
}

export interface ApiMemberStatement {
  member: { id: string; code: string; name: string };
  sales: ApiStatementSale[];
  totals: ApiCommissionTotals;
}

export interface CommissionQuery {
  member_id?: string;
  project_id?: string;
  share_sale_id?: string;
  status?: CommissionLineStatus;
  role?: 'seller' | 'override';
  /** this member and everybody under them */
  team_of?: string;
  page?: number;
  page_size?: number;
}

export interface ApiCommissionPage {
  rows: ApiCommissionLine[];
  /** over everything the filters match, not over the page */
  totals: ApiCommissionTotals;
}

export const commissionsApi = {
  page(query: CommissionQuery = {}, signal?: AbortSignal): Promise<ApiCommissionPage> {
    return api.get<ApiCommissionPage>('/commissions', { ...query }, signal);
  },

  async list(query: CommissionQuery = {}, signal?: AbortSignal): Promise<ApiCommissionLine[]> {
    return (await commissionsApi.page(query, signal)).rows;
  },

  forSale(saleId: string, signal?: AbortSignal): Promise<ApiCommissionLine[]> {
    return api.get<ApiCommissionLine[]>(`/share-sales/${saleId}/commission`, undefined, signal);
  },

  /** Says who sold a purchase, which is what starts its commission. */
  setSoldBy(saleId: string, sold_by_member_id: string | null): Promise<ApiCommissionLine[]> {
    return api.patch<ApiCommissionLine[]>(`/share-sales/${saleId}/commission`, {
      sold_by_member_id,
    });
  },

  /** Earned lines only; anything else is refused with the reason. */
  approve(ids: string[]): Promise<{ approved: number }> {
    return api.post<{ approved: number }>('/commissions/approve', { ids });
  },
};

export const commissionKeys = {
  all: ['commissions'] as const,
  list: (query: CommissionQuery) => ['commissions', 'list', query] as const,
  forSale: (saleId: string) => ['commissions', 'sale', saleId] as const,
};

export interface ApiPayoutPreview {
  member: { id: string; code: string; name: string };
  lines: ApiCommissionLine[];
  lines_total: number;
  to_recover: number;
  /** what this payout would take back — whole lines, as far as it covers them */
  recovering: ApiCommissionLine[];
  recover_now: number;
}

export interface ApiCommissionPayout {
  id: string;
  code: string;
  member_id: string;
  member_name: string;
  member_code: string;
  lines_total: number;
  recovered: number;
  tax_pct: number;
  tax_withheld: number;
  net: number;
  account_id: string | null;
  paid_on: string;
  reference_no: string | null;
  notes: string | null;
  line_count: number;
  created_at: string;
}

export interface PayoutWrite {
  member_id: string;
  paid_on: string;
  tax_pct?: number;
  account_id?: string | null;
  reference_no?: string | null;
  notes?: string | null;
}

export const payoutsApi = {
  page(
    query: { member_id?: string; page?: number; page_size?: number } = {},
    signal?: AbortSignal,
  ): Promise<Page<ApiCommissionPayout>> {
    return api.list<ApiCommissionPayout>('/commission-payouts', { ...query }, signal);
  },

  async list(
    query: { member_id?: string } = {},
    signal?: AbortSignal,
  ): Promise<ApiCommissionPayout[]> {
    return (await payoutsApi.page(query, signal)).rows;
  },

  /** Who has approved commission waiting, most owed first. */
  payable(signal?: AbortSignal): Promise<ApiPayoutPreview[]> {
    return api.get<ApiPayoutPreview[]>('/commission-payouts/payable', undefined, signal);
  },

  /** What one member's payout would come to — the same sums the save then runs. */
  preview(memberId: string, signal?: AbortSignal): Promise<ApiPayoutPreview> {
    return api.get<ApiPayoutPreview>(
      '/commission-payouts/payable',
      { member_id: memberId },
      signal,
    );
  },

  detail(
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    payout: ApiCommissionPayout;
    paid: ApiCommissionLine[];
    recovered: ApiCommissionLine[];
  }> {
    return api.get(`/commission-payouts/${id}`, undefined, signal);
  },

  pay(input: PayoutWrite): Promise<ApiCommissionPayout> {
    return api.post<ApiCommissionPayout>('/commission-payouts', input);
  },
};

export const payoutKeys = {
  all: ['commission-payouts'] as const,
  list: (memberId?: string) => ['commission-payouts', 'list', memberId ?? null] as const,
  payable: () => ['commission-payouts', 'payable'] as const,
  preview: (memberId: string) => ['commission-payouts', 'preview', memberId] as const,
  one: (id: string) => ['commission-payouts', 'one', id] as const,
};

/* ------------------------------------------------------------------ *
 * The designation list
 * ------------------------------------------------------------------ */

export interface ApiDesignation {
  id: string;
  value: string;
  sort_order: number;
}

/**
 * The designations, top rank first.
 *
 * They are `lookup_values` the client edits in Master Data, and a plan's
 * overrides are keyed by their id — so renaming one never detaches a member or
 * an override from it.
 */
export const designationsApi = {
  list(signal?: AbortSignal): Promise<ApiDesignation[]> {
    return api.get<ApiDesignation[]>('/lookups', { category: 'org_designation' }, signal);
  },
};

export const designationKeys = { all: ['lookups', 'org_designation'] as const };
