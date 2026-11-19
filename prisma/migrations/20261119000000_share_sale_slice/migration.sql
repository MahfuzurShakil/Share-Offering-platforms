-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('buyer', 'investor');

-- CreateEnum
CREATE TYPE "ShareOfferingStatus" AS ENUM ('draft', 'open', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "ShareFrequency" AS ENUM ('monthly', 'quarterly');

-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('pct_once', 'fixed_once');

-- CreateEnum
CREATE TYPE "ShareSaleStatus" AS ENUM ('reserved', 'agreement_signed', 'fully_paid', 'released', 'cancelled');

-- CreateEnum
CREATE TYPE "SharePaymentMethod" AS ENUM ('bank_transfer', 'cheque', 'cash', 'bkash', 'nagad', 'card', 'online', 'profit_adjustment');

-- CreateEnum
CREATE TYPE "SharePaymentChannel" AS ENUM ('office', 'online');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(200),
    "customer_type" "CustomerType" NOT NULL DEFAULT 'investor',
    "lead_id" UUID,
    "nid" VARCHAR(40),
    "tin" VARCHAR(40),
    "date_of_birth" DATE,
    "father_or_spouse_name" VARCHAR(200),
    "profession" VARCHAR(120),
    "address" TEXT,
    "permanent_address" TEXT,
    "kyc_verified_on" DATE,
    "nominee_name" VARCHAR(200),
    "nominee_relation" VARCHAR(80),
    "nominee_phone" VARCHAR(20),
    "nominee_nid" VARCHAR(40),
    "bank_name" VARCHAR(160),
    "bank_branch" VARCHAR(160),
    "bank_account" VARCHAR(60),
    "password_hash" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_offerings" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "project_id" UUID NOT NULL,
    "round_no" INTEGER NOT NULL,
    "net_asset_value" DECIMAL(18,2) NOT NULL,
    "premium_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "valuation" DECIMAL(18,2) NOT NULL,
    "valuation_date" DATE NOT NULL,
    "offered_pct" DECIMAL(9,6) NOT NULL,
    "total_shares" INTEGER NOT NULL,
    "share_pct" DECIMAL(9,6) NOT NULL,
    "price_per_share" DECIMAL(18,2) NOT NULL,
    "validity_days" INTEGER NOT NULL DEFAULT 120,
    "opens_on" DATE,
    "closes_on" DATE,
    "min_shares" INTEGER NOT NULL DEFAULT 1,
    "max_shares" INTEGER,
    "min_down_payment_pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "max_installments" INTEGER NOT NULL DEFAULT 0,
    "installment_frequency" "ShareFrequency" NOT NULL DEFAULT 'monthly',
    "late_fee_type" "LateFeeType" NOT NULL DEFAULT 'pct_once',
    "late_fee_pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "late_fee_amount" DECIMAL(18,2),
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "hold_days" INTEGER NOT NULL DEFAULT 7,
    "status" "ShareOfferingStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "share_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_sales" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "offering_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "shares" INTEGER NOT NULL,
    "share_pct" DECIMAL(9,6) NOT NULL,
    "price_per_share" DECIMAL(18,2) NOT NULL,
    "total_price" DECIMAL(18,2) NOT NULL,
    "down_payment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "installment_count" INTEGER NOT NULL DEFAULT 0,
    "installment_frequency" "ShareFrequency" NOT NULL DEFAULT 'monthly',
    "reserved_on" DATE NOT NULL,
    "hold_until" DATE NOT NULL,
    "agreement_no" VARCHAR(40),
    "agreement_date" DATE,
    "first_due_date" DATE,
    "certificate_no" VARCHAR(40),
    "certificate_date" DATE,
    "status" "ShareSaleStatus" NOT NULL DEFAULT 'reserved',
    "status_note" TEXT,
    "notes" TEXT,
    "signing" JSONB,
    "sign_draft" JSONB,
    "sold_by_member_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "share_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_installments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "share_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_payments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "sale_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "late_fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "method" "SharePaymentMethod" NOT NULL,
    "reference" VARCHAR(120),
    "channel" "SharePaymentChannel" NOT NULL DEFAULT 'office',
    "method_detail" VARCHAR(160),
    "account_id" UUID,
    "notes" TEXT,
    "reverses_payment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "share_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "late_fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_created_at_idx" ON "customers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "share_offerings_code_key" ON "share_offerings"("code");

-- CreateIndex
CREATE INDEX "share_offerings_project_id_status_idx" ON "share_offerings"("project_id", "status");

-- CreateIndex
CREATE INDEX "share_offerings_status_idx" ON "share_offerings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "share_offerings_project_id_round_no_key" ON "share_offerings"("project_id", "round_no");

-- CreateIndex
CREATE UNIQUE INDEX "share_sales_code_key" ON "share_sales"("code");

-- CreateIndex
CREATE UNIQUE INDEX "share_sales_agreement_no_key" ON "share_sales"("agreement_no");

-- CreateIndex
CREATE UNIQUE INDEX "share_sales_certificate_no_key" ON "share_sales"("certificate_no");

-- CreateIndex
CREATE INDEX "share_sales_offering_id_status_idx" ON "share_sales"("offering_id", "status");

-- CreateIndex
CREATE INDEX "share_sales_project_id_status_idx" ON "share_sales"("project_id", "status");

-- CreateIndex
CREATE INDEX "share_sales_customer_id_idx" ON "share_sales"("customer_id");

-- CreateIndex
CREATE INDEX "share_sales_sold_by_member_id_idx" ON "share_sales"("sold_by_member_id");

-- CreateIndex
CREATE INDEX "share_installments_due_date_idx" ON "share_installments"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "share_installments_sale_id_seq_key" ON "share_installments"("sale_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "share_payments_code_key" ON "share_payments"("code");

-- CreateIndex
CREATE INDEX "share_payments_sale_id_paid_on_idx" ON "share_payments"("sale_id", "paid_on");

-- CreateIndex
CREATE INDEX "share_payments_paid_on_idx" ON "share_payments"("paid_on");

-- CreateIndex
CREATE INDEX "share_payments_account_id_idx" ON "share_payments"("account_id");

-- CreateIndex
CREATE INDEX "share_payment_allocations_payment_id_idx" ON "share_payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "share_payment_allocations_installment_id_idx" ON "share_payment_allocations"("installment_id");

-- AddForeignKey
ALTER TABLE "share_offerings" ADD CONSTRAINT "share_offerings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_sales" ADD CONSTRAINT "share_sales_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "share_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_sales" ADD CONSTRAINT "share_sales_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_sales" ADD CONSTRAINT "share_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_installments" ADD CONSTRAINT "share_installments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "share_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_payments" ADD CONSTRAINT "share_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "share_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_payments" ADD CONSTRAINT "share_payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES "share_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_payment_allocations" ADD CONSTRAINT "share_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "share_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_payment_allocations" ADD CONSTRAINT "share_payment_allocations_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "share_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
-- A receipt cannot be edited or torn out.
--
-- Financial rows are immutable (AGENTS.md): a mistake on a share payment is
-- corrected by a reversing payment that points at the one it reverses, never
-- by an UPDATE or a DELETE. The rule is here, in the database, rather than in
-- the service that happens to write them — a script, a console or a future
-- module would otherwise be free to break it.
--
-- `share_installments` are deliberately NOT in this: they are the schedule
-- that was agreed, which can still be renegotiated. What was paid is what is
-- frozen.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION share_payment_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is not allowed on %: a payment is corrected by a reversing payment, not by changing it',
    TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER share_payments_no_change
  BEFORE UPDATE OR DELETE ON "share_payments"
  FOR EACH ROW EXECUTE FUNCTION share_payment_append_only();

CREATE TRIGGER share_payment_allocations_no_change
  BEFORE UPDATE OR DELETE ON "share_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION share_payment_append_only();
