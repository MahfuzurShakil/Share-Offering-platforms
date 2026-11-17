/**
 * The repository barrel — the only data door the UI knows.
 *
 * Phase 1 (share-sale build) carries projects, share sale, profit sharing,
 * sales organisation and commission, fund and partners, customers, leads,
 * users, website content and documents. The land, construction, procurement
 * and flat-sale repositories live in the prototype's history and return in
 * Phase 2.
 */
export * from './base.repository';
export { documentRepository } from './document.repository';
export {
  lookupRepository,
  DuplicateLookupError,
  SystemOptionError,
  CODE_KEYED_LOOKUP_CATEGORIES,
  type LookupGroupKey,
} from './lookup.repository';
export { companySettingsRepository } from './settings.repository';
export {
  bankAccountRepository,
  BankAccountInUseError,
  type AccountWithPosition,
  type CashPosition,
} from './bank.repository';
export { projectRepository, type ProjectFilters } from './project.repository';
export {
  leadRepository,
  leadActivityRepository,
  normalizePhone,
  type LeadFilters,
  type LeadWithRelations,
  type DedupResult,
} from './lead.repository';
export {
  customerRepository,
  type CustomerFilters,
  type CustomerWithRelations,
} from './customer.repository';
export {
  customerPortfolioRepository,
  type CustomerPaymentRow,
  type CustomerPortfolio,
  type MoneyTotals,
  type ShareHolding,
} from './customer-portfolio.repository';
export {
  userRepository,
  userProjectAssignmentRepository,
  DuplicateUserError,
  type UserFilters,
  type UserWithAccess,
} from './user.repository';
export {
  partnerRepository,
  fundReceiptRepository,
  fundAllocationRepository,
  fundOverview,
  fundLedger,
  splitProject,
  projectFundLeft,
  type ShareSlice,
  type FundReceiptInput,
  type FundOverview,
  type ProjectFundRow,
  type PartnerRow,
  type LedgerRow,
} from './fund.repository';
export {
  testimonialRepository,
  teamMemberRepository,
  awardRepository,
  faqItemRepository,
} from './website-content.repository';
export { blogRepository, DuplicateSlugError, slugify } from './blog.repository';
export {
  shareOfferingRepository,
  shareSaleRepository,
  sharePaymentRepository,
  shareInstallmentRepository,
  shareSaleOverview,
  shareTransactions,
  projectOwnership,
  shareRequestRepository,
  customerUploadRepository,
  customerPortalInbox,
  customerShareFile,
  type RequestRow,
  type UploadRow,
  type OfferingInput,
  type OfferingRow,
  type OwnershipRow,
  type PaymentInput as SharePaymentInput,
  type SignInput as ShareSignInput,
  type PlanChange as SharePlanChange,
  type KycField,
  type ReserveInput,
  type SaleRow,
  type ShareSaleOverview,
  type ShareTransactionRow,
} from './share-sale.repository';
export {
  OFFLINE_METHOD_LABEL,
  paymentSubmissionInbox,
  paymentSubmissionRepository,
  type SubmissionRow,
} from './payment-submission.repository';
export {
  DEFAULT_REVENUE_POLICY,
  customerProfitBalances,
  customerProfitHistory,
  loanRepository,
  lossCoveringRepository,
  partnerProfitBalances,
  previewPeriod,
  profitDistributions,
  profitWithdrawalRepository,
  projectProfitBalances,
  revenueEntryRepository,
  revenueOverview,
  revenuePeriodRepository,
  revenuePolicyRepository,
  projectCapTable,
  type CapTableRow,
  type CoverLine,
  type DistributionRow,
  type HolderBalance,
  type HolderLine,
  type LoanInput,
  type LoanRow,
  type PeriodDetail,
  type PeriodPreview,
  type PeriodRow,
  type RevenueOverview,
  type RevenuePolicyInput,
  type WithdrawalRow,
} from './revenue.repository';
export {
  orgMemberRepository,
  orgMoveRepository,
  ORG_DESIGNATION,
  type OrgMemberInput,
  type OrgNode,
} from './org.repository';
export {
  commissionPlanRepository,
  commissionLineRepository,
  commissionPayoutRepository,
  commissionTotals,
  syncCommissions,
  type CommissionLineRow,
  type CommissionPlanInput,
  type CommissionTotals,
  type PayoutInput,
  type PayoutPreview,
  type PayoutRow,
  type SaleStatementRow,
} from './commission.repository';
