-- CreateEnum
CREATE TYPE "RevenueEntryFrequency" AS ENUM ('daily', 'monthly', 'quarterly');

-- CreateEnum
CREATE TYPE "DistributionFrequency" AS ENUM ('monthly', 'quarterly', 'half_yearly', 'yearly');

-- CreateEnum
CREATE TYPE "MgmtFeeType" AS ENUM ('none', 'pct_income', 'pct_profit', 'fixed');

-- CreateEnum
CREATE TYPE "LossRule" AS ENUM ('recover_first', 'ignore');

-- CreateEnum
CREATE TYPE "EligibilityRule" AS ENUM ('fully_paid', 'pro_rata_paid', 'all_signed');

-- CreateEnum
CREATE TYPE "WithdrawalWindow" AS ENUM ('any_time', 'after_declare', 'day_of_month');

-- CreateEnum
CREATE TYPE "RevenueDirection" AS ENUM ('income', 'cost');

-- CreateEnum
CREATE TYPE "RevenuePeriodStatus" AS ENUM ('closed', 'approved', 'declared', 'cancelled');

-- CreateEnum
CREATE TYPE "ProfitHolderType" AS ENUM ('customer', 'partner');

-- CreateTable
CREATE TABLE "revenue_policies" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entry_frequency" "RevenueEntryFrequency" NOT NULL DEFAULT 'daily',
    "distribution_frequency" "DistributionFrequency" NOT NULL DEFAULT 'quarterly',
    "first_period_start" DATE NOT NULL,
    "reserve_pct" DECIMAL(6,3) NOT NULL DEFAULT 10,
    "mgmt_fee_type" "MgmtFeeType" NOT NULL DEFAULT 'none',
    "mgmt_fee_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_withholding_pct" DECIMAL(6,3) NOT NULL DEFAULT 10,
    "loss_rule" "LossRule" NOT NULL DEFAULT 'recover_first',
    "eligibility_rule" "EligibilityRule" NOT NULL DEFAULT 'pro_rata_paid',
    "prorate_days" BOOLEAN NOT NULL DEFAULT true,
    "repay_loans_first" BOOLEAN NOT NULL DEFAULT false,
    "min_withdrawal" DECIMAL(18,2) NOT NULL DEFAULT 5000,
    "withdrawal_window" "WithdrawalWindow" NOT NULL DEFAULT 'any_time',
    "withdrawal_window_days" INTEGER NOT NULL DEFAULT 0,
    "adjust_overdue_first" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "revenue_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_entries" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "project_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "direction" "RevenueDirection" NOT NULL,
    "head" VARCHAR(120) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "account_id" UUID,
    "reference_no" VARCHAR(120),
    "notes" TEXT,
    "period_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "revenue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_periods" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "project_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "status" "RevenuePeriodStatus" NOT NULL DEFAULT 'closed',
    "income" DECIMAL(18,2) NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "operating_profit" DECIMAL(18,2) NOT NULL,
    "loss_brought_in" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reserve" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "mgmt_fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "loan_principal_due" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "available" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "loss_carried_out" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "declared" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "record_date" DATE,
    "closed_by" UUID,
    "approved_by" UUID,
    "approved_on" DATE,
    "declared_by" UUID,
    "declared_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "revenue_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_allocations" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "holder_type" "ProfitHolderType" NOT NULL,
    "customer_id" UUID,
    "partner_id" UUID,
    "share_sale_id" UUID,
    "ownership_pct" DECIMAL(9,6) NOT NULL,
    "eligibility_factor" DECIMAL(9,6) NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "tax_withheld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjusted_to_dues" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_credited" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "profit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revenue_policies_project_id_key" ON "revenue_policies"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_entries_code_key" ON "revenue_entries"("code");

-- CreateIndex
CREATE INDEX "revenue_entries_project_id_entry_date_idx" ON "revenue_entries"("project_id", "entry_date");

-- CreateIndex
CREATE INDEX "revenue_entries_period_id_idx" ON "revenue_entries"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_periods_code_key" ON "revenue_periods"("code");

-- CreateIndex
CREATE INDEX "revenue_periods_project_id_status_idx" ON "revenue_periods"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_periods_project_id_period_start_key" ON "revenue_periods"("project_id", "period_start");

-- CreateIndex
CREATE INDEX "profit_allocations_project_id_customer_id_idx" ON "profit_allocations"("project_id", "customer_id");

-- CreateIndex
CREATE INDEX "profit_allocations_period_id_idx" ON "profit_allocations"("period_id");

-- AddForeignKey
ALTER TABLE "revenue_policies" ADD CONSTRAINT "revenue_policies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "revenue_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_periods" ADD CONSTRAINT "revenue_periods_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "revenue_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

