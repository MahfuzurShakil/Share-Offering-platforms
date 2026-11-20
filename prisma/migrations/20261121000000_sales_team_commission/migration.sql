-- CreateEnum
CREATE TYPE "OrgMemberStatus" AS ENUM ('active', 'left');

-- CreateEnum
CREATE TYPE "CommissionAppliesTo" AS ENUM ('share_sale', 'booking');

-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('pct', 'per_share', 'per_sale');

-- CreateEnum
CREATE TYPE "CommissionTrigger" AS ENUM ('agreement', 'down_payment', 'agreement_down_payment', 'paid_pct', 'fully_paid', 'handover');

-- CreateEnum
CREATE TYPE "CommissionCancelRule" AS ENUM ('recover', 'write_off');

-- CreateEnum
CREATE TYPE "CommissionPlanStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "CommissionSaleKind" AS ENUM ('share', 'booking');

-- CreateEnum
CREATE TYPE "CommissionLineStatus" AS ENUM ('pending', 'earned', 'approved', 'paid', 'void', 'recovered');

-- CreateEnum
CREATE TYPE "CommissionLineRole" AS ENUM ('seller', 'override');

-- CreateTable
CREATE TABLE "org_members" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "designation_id" UUID NOT NULL,
    "parent_id" UUID,
    "user_id" UUID,
    "partner_id" UUID,
    "joined_on" DATE NOT NULL,
    "left_on" DATE,
    "status" "OrgMemberStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_moves" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "from_parent_id" UUID,
    "to_parent_id" UUID,
    "effective_date" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "org_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "applies_to" "CommissionAppliesTo" NOT NULL DEFAULT 'share_sale',
    "project_id" UUID,
    "offering_id" UUID,
    "seller_basis" "CommissionBasis" NOT NULL DEFAULT 'pct',
    "seller_value" DECIMAL(18,6) NOT NULL,
    "stages" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "cancel_rule" "CommissionCancelRule" NOT NULL DEFAULT 'recover',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "CommissionPlanStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "commission_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_lines" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "sale_kind" "CommissionSaleKind" NOT NULL DEFAULT 'share',
    "share_sale_id" UUID,
    "booking_id" UUID,
    "project_id" UUID,
    "member_id" UUID NOT NULL,
    "role" "CommissionLineRole" NOT NULL,
    "designation_at_sale" VARCHAR(200) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "stage_key" VARCHAR(64) NOT NULL,
    "stage_label" VARCHAR(200) NOT NULL,
    "stage_seq" INTEGER NOT NULL,
    "sale_date" DATE NOT NULL,
    "sale_amount" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "CommissionLineStatus" NOT NULL DEFAULT 'pending',
    "earned_on" DATE,
    "approved_by" UUID,
    "approved_on" DATE,
    "payout_id" UUID,
    "to_recover" BOOLEAN NOT NULL DEFAULT false,
    "recovered_payout_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "commission_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payouts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "member_id" UUID NOT NULL,
    "lines_total" DECIMAL(18,2) NOT NULL,
    "recovered" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "tax_withheld" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL,
    "account_id" UUID,
    "paid_on" DATE NOT NULL,
    "reference_no" VARCHAR(120),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_members_code_key" ON "org_members"("code");

-- CreateIndex
CREATE INDEX "org_members_parent_id_idx" ON "org_members"("parent_id");

-- CreateIndex
CREATE INDEX "org_members_designation_id_idx" ON "org_members"("designation_id");

-- CreateIndex
CREATE INDEX "org_members_status_idx" ON "org_members"("status");

-- CreateIndex
CREATE INDEX "org_members_user_id_idx" ON "org_members"("user_id");

-- CreateIndex
CREATE INDEX "org_moves_member_id_effective_date_idx" ON "org_moves"("member_id", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "commission_plans_code_key" ON "commission_plans"("code");

-- CreateIndex
CREATE INDEX "commission_plans_status_applies_to_idx" ON "commission_plans"("status", "applies_to");

-- CreateIndex
CREATE INDEX "commission_plans_project_id_idx" ON "commission_plans"("project_id");

-- CreateIndex
CREATE INDEX "commission_plans_offering_id_idx" ON "commission_plans"("offering_id");

-- CreateIndex
CREATE INDEX "commission_plans_effective_from_idx" ON "commission_plans"("effective_from");

-- CreateIndex
CREATE INDEX "commission_lines_member_id_status_idx" ON "commission_lines"("member_id", "status");

-- CreateIndex
CREATE INDEX "commission_lines_share_sale_id_idx" ON "commission_lines"("share_sale_id");

-- CreateIndex
CREATE INDEX "commission_lines_project_id_idx" ON "commission_lines"("project_id");

-- CreateIndex
CREATE INDEX "commission_lines_plan_id_idx" ON "commission_lines"("plan_id");

-- CreateIndex
CREATE INDEX "commission_lines_payout_id_idx" ON "commission_lines"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_payouts_code_key" ON "commission_payouts"("code");

-- CreateIndex
CREATE INDEX "commission_payouts_member_id_paid_on_idx" ON "commission_payouts"("member_id", "paid_on");

-- AddForeignKey
ALTER TABLE "share_sales" ADD CONSTRAINT "share_sales_sold_by_member_id_fkey" FOREIGN KEY ("sold_by_member_id") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_moves" ADD CONSTRAINT "org_moves_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "org_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "share_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "commission_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "org_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_share_sale_id_fkey" FOREIGN KEY ("share_sale_id") REFERENCES "share_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "commission_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_lines" ADD CONSTRAINT "commission_lines_recovered_payout_id_fkey" FOREIGN KEY ("recovered_payout_id") REFERENCES "commission_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "org_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A payout is money that left the company. Like every other such row in this
-- database (share_payments, share_payment_allocations), it cannot be edited or
-- deleted: a mistake is corrected by a further payout.
--
-- The commission LINES a payout paid stay mutable on purpose — a line's amount
-- never changes, but its status does as the ledger reaches each stage, and a
-- paid line on a cancelled sale has to be flagged for recovery.
CREATE OR REPLACE FUNCTION commission_payout_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is not allowed on %: a payout is corrected by a further payout, not by changing it',
    TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER commission_payouts_no_change
  BEFORE UPDATE OR DELETE ON "commission_payouts"
  FOR EACH ROW EXECUTE FUNCTION commission_payout_append_only();
