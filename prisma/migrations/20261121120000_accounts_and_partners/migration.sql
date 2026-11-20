-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('bank', 'mfs', 'cash');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "BankAccountType" NOT NULL DEFAULT 'bank',
    "bank_name" VARCHAR(200),
    "account_number" VARCHAR(60),
    "branch" VARCHAR(200),
    "opening_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opening_balance_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "nid" VARCHAR(40),
    "share_pct" DECIMAL(9,6) NOT NULL,
    "project_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_share_history" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "share_pct" DECIMAL(9,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "partner_share_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_code_key" ON "bank_accounts"("code");

-- CreateIndex
CREATE INDEX "bank_accounts_is_active_idx" ON "bank_accounts"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partners_is_active_idx" ON "partners"("is_active");

-- CreateIndex
CREATE INDEX "partners_project_id_idx" ON "partners"("project_id");

-- CreateIndex
CREATE INDEX "partner_share_history_partner_id_effective_from_idx" ON "partner_share_history"("partner_id", "effective_from");

-- AddForeignKey
ALTER TABLE "profit_allocations" ADD CONSTRAINT "profit_allocations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_withdrawals" ADD CONSTRAINT "profit_withdrawals_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_share_history" ADD CONSTRAINT "partner_share_history_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

