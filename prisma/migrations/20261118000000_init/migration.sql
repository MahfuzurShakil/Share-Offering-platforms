-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('staff', 'customer');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'login_failed', 'permission_change', 'export');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('land_share', 'plot_development', 'apartment', 'commercial', 'mixed');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('planning', 'design', 'approval', 'under_construction', 'nearly_complete', 'handover_ongoing', 'closed');

-- CreateEnum
CREATE TYPE "ProjectSalesStatus" AS ENUM ('not_open', 'open', 'paused', 'sold_out');

-- CreateEnum
CREATE TYPE "LandSizeUnit" AS ENUM ('katha', 'bigha', 'decimal');

-- CreateEnum
CREATE TYPE "ConstructionAfterSale" AS ENUM ('undecided', 'planned', 'none');

-- CreateTable
CREATE TABLE "lookup_values" (
    "id" UUID NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(64),
    "value" VARCHAR(200) NOT NULL,
    "code" VARCHAR(64),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "lookup_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" UUID NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(200),
    "tagline" VARCHAR(300),
    "about" TEXT,
    "phone" VARCHAR(40),
    "alt_phone" VARCHAR(40),
    "email" VARCHAR(200),
    "website" VARCHAR(200),
    "address" TEXT,
    "tax_id" VARCHAR(60),
    "trade_licence_no" VARCHAR(60),
    "rehab_member_no" VARCHAR(60),
    "established_year" INTEGER,
    "logo_document_id" UUID,
    "letterhead_document_id" UUID,
    "facebook_url" VARCHAR(300),
    "youtube_url" VARCHAR(300),
    "instagram_url" VARCHAR(300),
    "linkedin_url" VARCHAR(300),
    "public_show_prices" BOOLEAN NOT NULL DEFAULT true,
    "public_show_share_sale" BOOLEAN NOT NULL DEFAULT false,
    "default_currency" VARCHAR(8) NOT NULL DEFAULT 'BDT',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(200),
    "password_hash" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "role_code" VARCHAR(64) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_project_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "user_project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "token_hash" TEXT NOT NULL,
    "device" VARCHAR(200),
    "ip" VARCHAR(64),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_attempts" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "identifier" VARCHAR(200),
    "ip" VARCHAR(64),
    "ok" BOOLEAN NOT NULL,
    "reason" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "AuditAction" NOT NULL,
    "actor_user_id" UUID,
    "actor_customer_id" UUID,
    "actor_role" VARCHAR(64),
    "table_name" VARCHAR(64) NOT NULL,
    "record_id" UUID,
    "record_code" VARCHAR(40),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "request_id" VARCHAR(64),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_series" (
    "id" UUID NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "period" VARCHAR(16) NOT NULL,
    "next_no" INTEGER NOT NULL DEFAULT 1,
    "width" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "code_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "document_type" VARCHAR(64) NOT NULL,
    "custom_type_name" VARCHAR(120),
    "storage_key" VARCHAR(400),
    "external_url" VARCHAR(400),
    "file_name" VARCHAR(260),
    "file_size" INTEGER,
    "mime_type" VARCHAR(120),
    "document_no" VARCHAR(40),
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "project_type" "ProjectType" NOT NULL DEFAULT 'land_share',
    "status" "ProjectStatus" NOT NULL DEFAULT 'planning',
    "sales_status" "ProjectSalesStatus" NOT NULL DEFAULT 'not_open',
    "total_land_area" DECIMAL(14,2),
    "total_land_area_unit" "LandSizeUnit",
    "location_summary" VARCHAR(300),
    "expected_start_date" DATE,
    "expected_completion_date" DATE,
    "project_manager_id" UUID,
    "architect" VARCHAR(200),
    "surroundings" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_image_url" VARCHAR(400),
    "cover_image_document_id" UUID,
    "construction_after_sale" "ConstructionAfterSale" NOT NULL DEFAULT 'undecided',
    "default_late_fee_pct" DECIMAL(6,3),
    "default_late_fee_grace_days" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lookup_values_category_is_active_sort_order_idx" ON "lookup_values"("category", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_values_category_scope_value_key" ON "lookup_values"("category", "scope", "value");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_module_key" ON "role_permissions"("role_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_project_assignments_user_id_project_id_key" ON "user_project_assignments"("user_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_customer_id_idx" ON "sessions"("customer_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");

-- CreateIndex
CREATE INDEX "auth_attempts_kind_identifier_created_at_idx" ON "auth_attempts"("kind", "identifier", "created_at");

-- CreateIndex
CREATE INDEX "auth_attempts_kind_ip_created_at_idx" ON "auth_attempts"("kind", "ip", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_table_name_record_id_idx" ON "audit_log"("table_name", "record_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_at_idx" ON "audit_log"("actor_user_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE UNIQUE INDEX "code_series_module_period_key" ON "code_series"("module", "period");

-- CreateIndex
CREATE INDEX "documents_entity_type_entity_id_idx" ON "documents"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "documents_document_type_idx" ON "documents"("document_type");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_sales_status_idx" ON "projects"("sales_status");

-- CreateIndex
CREATE INDEX "projects_is_public_is_featured_idx" ON "projects"("is_public", "is_featured");

-- CreateIndex
CREATE INDEX "projects_created_at_idx" ON "projects"("created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_project_assignments" ADD CONSTRAINT "user_project_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_project_assignments" ADD CONSTRAINT "user_project_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
-- The audit trail is append-only (AGENTS.md). Revoking UPDATE and DELETE from
-- the application's role is the other half of this and belongs to deployment;
-- the trigger is here so the rule holds on any database this schema is
-- applied to, including a developer's own.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed on it', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
