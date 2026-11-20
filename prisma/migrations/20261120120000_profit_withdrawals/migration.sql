-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('requested', 'approved', 'paid', 'rejected');

-- CreateEnum
CREATE TYPE "WithdrawalMethod" AS ENUM ('bank_transfer', 'bkash', 'nagad', 'cheque', 'cash');

-- CreateTable
CREATE TABLE "profit_withdrawals" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "project_id" UUID NOT NULL,
    "holder_type" "ProfitHolderType" NOT NULL,
    "customer_id" UUID,
    "partner_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "WithdrawalMethod" NOT NULL DEFAULT 'bank_transfer',
    "pay_to" VARCHAR(200) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'requested',
    "requested_on" DATE NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'office',
    "decided_by" UUID,
    "decided_on" DATE,
    "reject_reason" TEXT,
    "paid_on" DATE,
    "account_id" UUID,
    "reference_no" VARCHAR(120),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "profit_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profit_withdrawals_code_key" ON "profit_withdrawals"("code");

-- CreateIndex
CREATE INDEX "profit_withdrawals_project_id_status_idx" ON "profit_withdrawals"("project_id", "status");

-- CreateIndex
CREATE INDEX "profit_withdrawals_customer_id_idx" ON "profit_withdrawals"("customer_id");

-- AddForeignKey
ALTER TABLE "profit_withdrawals" ADD CONSTRAINT "profit_withdrawals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_withdrawals" ADD CONSTRAINT "profit_withdrawals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

