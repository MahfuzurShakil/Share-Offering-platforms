'use client';

import Dexie, { type EntityTable } from 'dexie';
import type {
  Award,
  BankAccount,
  BlogPost,
  CommissionLine,
  CommissionPayout,
  CommissionPlan,
  CompanySettings,
  Customer,
  CustomerUpload,
  CustomerUploadFile,
  DocumentRecord,
  FaqItem,
  FundAllocation,
  FundReceipt,
  Lead,
  LeadActivity,
  Loan,
  LoanRepayment,
  LookupValue,
  LossCovering,
  OrgMember,
  OrgMove,
  Partner,
  PaymentSubmission,
  ProfitAllocation,
  ProfitWithdrawal,
  Project,
  ProjectPartner,
  RevenueEntry,
  RevenuePeriod,
  RevenuePolicy,
  ShareInstallment,
  ShareOffering,
  SharePayment,
  ShareRequest,
  ShareSale,
  TeamMember,
  Testimonial,
  User,
  UserProjectAssignment,
} from './types';

/**
 * The shared IndexedDB behind both portals — INTERIM.
 *
 * This is the share-sale build's starting point, not its data layer: the
 * platform moves to PostgreSQL + Prisma behind `/api/v1`, and this file goes
 * away with the last `useLiveQuery` call site. Until then the UI keeps running
 * against the same repository API it always used.
 *
 * It is one `version(1)` on purpose. The prototype carries 49 version blocks
 * because it has installs to upgrade; this product has none, so the schema
 * below is the prototype's 49 blocks already merged, with the land,
 * construction, procurement and flat-sale tables left out.
 *
 * Public routes must never touch this object directly — they go through
 * `lib/repositories/public/*`, which whitelists fields.
 */
class AppDatabase extends Dexie {
  documents!: EntityTable<DocumentRecord, 'id'>;

  lookup_values!: EntityTable<LookupValue, 'id'>;

  company_settings!: EntityTable<CompanySettings, 'id'>;

  projects!: EntityTable<Project, 'id'>;

  users!: EntityTable<User, 'id'>;

  user_project_assignments!: EntityTable<UserProjectAssignment, 'id'>;

  leads!: EntityTable<Lead, 'id'>;

  lead_activities!: EntityTable<LeadActivity, 'id'>;

  customers!: EntityTable<Customer, 'id'>;

  bank_accounts!: EntityTable<BankAccount, 'id'>;

  partners!: EntityTable<Partner, 'id'>;

  project_partners!: EntityTable<ProjectPartner, 'id'>;

  fund_receipts!: EntityTable<FundReceipt, 'id'>;

  fund_allocations!: EntityTable<FundAllocation, 'id'>;

  share_offerings!: EntityTable<ShareOffering, 'id'>;

  share_sales!: EntityTable<ShareSale, 'id'>;

  share_installments!: EntityTable<ShareInstallment, 'id'>;

  share_payments!: EntityTable<SharePayment, 'id'>;

  share_requests!: EntityTable<ShareRequest, 'id'>;

  customer_uploads!: EntityTable<CustomerUpload, 'id'>;

  customer_upload_files!: EntityTable<CustomerUploadFile, 'id'>;

  payment_submissions!: EntityTable<PaymentSubmission, 'id'>;

  revenue_policies!: EntityTable<RevenuePolicy, 'id'>;

  revenue_entries!: EntityTable<RevenueEntry, 'id'>;

  revenue_periods!: EntityTable<RevenuePeriod, 'id'>;

  loss_coverings!: EntityTable<LossCovering, 'id'>;

  loans!: EntityTable<Loan, 'id'>;

  loan_repayments!: EntityTable<LoanRepayment, 'id'>;

  profit_allocations!: EntityTable<ProfitAllocation, 'id'>;

  profit_withdrawals!: EntityTable<ProfitWithdrawal, 'id'>;

  org_members!: EntityTable<OrgMember, 'id'>;

  org_moves!: EntityTable<OrgMove, 'id'>;

  commission_plans!: EntityTable<CommissionPlan, 'id'>;

  commission_lines!: EntityTable<CommissionLine, 'id'>;

  commission_payouts!: EntityTable<CommissionPayout, 'id'>;

  testimonials!: EntityTable<Testimonial, 'id'>;

  team_members!: EntityTable<TeamMember, 'id'>;

  awards!: EntityTable<Award, 'id'>;

  faq_items!: EntityTable<FaqItem, 'id'>;

  blog_posts!: EntityTable<BlogPost, 'id'>;

  constructor() {
    super('RealEstatePlatform');

    this.version(1).stores({
      documents: 'id, entity_type, entity_id, document_type, is_public, [entity_type+entity_id]',
      lookup_values: 'id, category, scope, is_active, sort_order, [category+scope]',
      company_settings: 'id',
      projects: 'id, &code, name, status, sales_status, project_type, is_public, is_featured, created_at',
      users: 'id, &phone, &email, name, role, status',
      user_project_assignments: 'id, user_id, project_id, &[user_id+project_id]',
      leads: 'id, &code, &phone, name, status, source, assigned_to, interested_project_id, created_at',
      lead_activities: 'id, lead_id, activity_type, activity_date, next_follow_up_date',
      customers: 'id, &code, &phone, name, lead_id, created_at',
      bank_accounts: 'id, &code, name, type, is_active',
      partners: 'id, code, name',
      project_partners: 'id, project_id, partner_id, [project_id+partner_id]',
      fund_receipts: 'id, code, source_type, partner_id, project_id, account_id, receipt_date',
      fund_allocations: 'id, code, project_id, allocation_date',
      share_offerings: 'id, &code, project_id, status',
      share_sales: 'id, &code, offering_id, project_id, customer_id, status, sold_by_member_id',
      share_installments: 'id, sale_id, due_date',
      share_payments: 'id, &code, sale_id, paid_on, account_id',
      share_requests: 'id, &code, offering_id, project_id, customer_id, status',
      customer_uploads: 'id, customer_id, sale_id, status',
      customer_upload_files: 'id',
      payment_submissions: 'id, &code, customer_id, holding_code, status',
      revenue_policies: 'id, &project_id',
      revenue_entries: 'id, &code, project_id, entry_date, direction, account_id',
      revenue_periods: 'id, &code, project_id, period_start, status',
      loss_coverings: 'id, period_id, project_id, loan_id',
      loans: 'id, &code, project_id, status, partner_id',
      loan_repayments: 'id, &code, loan_id, project_id, paid_on',
      profit_allocations: 'id, period_id, project_id, customer_id, partner_id, share_sale_id',
      profit_withdrawals: 'id, &code, project_id, customer_id, partner_id, status',
      org_members: 'id, &code, parent_id, designation_id, user_id, partner_id, status',
      org_moves: 'id, member_id, effective_date',
      commission_plans: 'id, &code, applies_to, project_id, status',
      commission_lines: 'id, plan_id, share_sale_id, project_id, member_id, status, payout_id',
      commission_payouts: 'id, &code, member_id, paid_on, account_id',
      testimonials: 'id, project_id, sort_order',
      team_members: 'id, sort_order',
      awards: 'id, kind, sort_order',
      faq_items: 'id, category, sort_order',
      blog_posts: 'id, &slug, status, published_at',
    });
  }
}

let instance: AppDatabase | null = null;

/** The one database handle, created on first use in the browser. */
export function getDb(): AppDatabase {
  if (typeof window === 'undefined') {
    throw new Error('The database is only available in the browser.');
  }
  if (!instance) instance = new AppDatabase();
  return instance;
}

/**
 * A lazy handle, so importing a repository does not open the database.
 * Reads and writes go through this exactly as they did before.
 */
export const db = new Proxy({} as AppDatabase, {
  get(_target, prop: string | symbol) {
    const value = Reflect.get(getDb(), prop);
    return typeof value === 'function' ? value.bind(getDb()) : value;
  },
});
