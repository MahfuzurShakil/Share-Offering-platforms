-- CreateEnum
CREATE TYPE "ShareRequestStatus" AS ENUM ('new', 'contacted', 'reserved', 'declined', 'withdrawn');

-- CreateEnum
CREATE TYPE "ShareRequestSource" AS ENUM ('portal', 'website');

-- CreateEnum
CREATE TYPE "CustomerUploadKind" AS ENUM ('id_document', 'photo', 'tin', 'address_proof', 'nominee_id', 'bank_proof', 'signed_copy', 'allotment_letter', 'deed', 'payment_proof', 'pdc', 'source_of_funds', 'power_of_attorney', 'other');

-- CreateEnum
CREATE TYPE "CustomerUploadStatus" AS ENUM ('under_review', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "CustomerUploadSource" AS ENUM ('customer', 'office');

-- CreateEnum
CREATE TYPE "OfflinePaymentMethod" AS ENUM ('bank_deposit', 'bank_transfer', 'cheque_deposit', 'pay_order');

-- CreateEnum
CREATE TYPE "PaymentSubmissionStatus" AS ENUM ('submitted', 'confirmed', 'rejected', 'withdrawn');

-- CreateTable
CREATE TABLE "share_requests" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "offering_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "customer_id" UUID,
    "source" "ShareRequestSource" NOT NULL DEFAULT 'portal',
    "prospect_name" VARCHAR(200),
    "prospect_phone" VARCHAR(20),
    "prospect_email" VARCHAR(200),
    "shares" INTEGER NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ShareRequestStatus" NOT NULL DEFAULT 'new',
    "sale_id" UUID,
    "office_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "share_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_uploads" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "sale_id" UUID,
    "source" "CustomerUploadSource" NOT NULL DEFAULT 'customer',
    "kind" "CustomerUploadKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "note" TEXT,
    "storage_key" VARCHAR(400) NOT NULL,
    "file_name" VARCHAR(260) NOT NULL,
    "file_type" VARCHAR(120) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CustomerUploadStatus" NOT NULL DEFAULT 'under_review',
    "reviewed_by" UUID,
    "reviewed_on" DATE,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customer_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_submissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "OfflinePaymentMethod" NOT NULL,
    "paid_on" DATE NOT NULL,
    "paid_into_account_id" UUID,
    "reference" VARCHAR(120) NOT NULL,
    "note" TEXT,
    "slip_upload_id" UUID,
    "status" "PaymentSubmissionStatus" NOT NULL DEFAULT 'submitted',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "payment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_requests_code_key" ON "share_requests"("code");

-- CreateIndex
CREATE INDEX "share_requests_status_requested_at_idx" ON "share_requests"("status", "requested_at");

-- CreateIndex
CREATE INDEX "share_requests_offering_id_idx" ON "share_requests"("offering_id");

-- CreateIndex
CREATE INDEX "share_requests_customer_id_idx" ON "share_requests"("customer_id");

-- CreateIndex
CREATE INDEX "customer_uploads_customer_id_status_idx" ON "customer_uploads"("customer_id", "status");

-- CreateIndex
CREATE INDEX "customer_uploads_sale_id_idx" ON "customer_uploads"("sale_id");

-- CreateIndex
CREATE INDEX "customer_uploads_status_uploaded_at_idx" ON "customer_uploads"("status", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_submissions_code_key" ON "payment_submissions"("code");

-- CreateIndex
CREATE INDEX "payment_submissions_status_created_at_idx" ON "payment_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_submissions_customer_id_idx" ON "payment_submissions"("customer_id");

-- CreateIndex
CREATE INDEX "payment_submissions_sale_id_idx" ON "payment_submissions"("sale_id");

-- AddForeignKey
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "share_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_requests" ADD CONSTRAINT "share_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "share_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_uploads" ADD CONSTRAINT "customer_uploads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_uploads" ADD CONSTRAINT "customer_uploads_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "share_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "share_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_paid_into_account_id_fkey" FOREIGN KEY ("paid_into_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_slip_upload_id_fkey" FOREIGN KEY ("slip_upload_id") REFERENCES "customer_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "share_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

