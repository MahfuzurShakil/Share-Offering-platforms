-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'site_visit_scheduled', 'site_visit_done', 'negotiation', 'booked', 'lost');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('website_form', 'whatsapp', 'facebook_ad', 'walk_in', 'referral', 'phone_call', 'other');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('call', 'whatsapp', 'email', 'site_visit', 'meeting', 'status_change', 'other');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(200),
    "source" "LeadSource" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "inquiry_message" TEXT,
    "interested_project_id" UUID,
    "budget_range" VARCHAR(80),
    "assigned_to" UUID,
    "lost_reason" TEXT,
    "page_url" VARCHAR(400),
    "utm_source" VARCHAR(120),
    "utm_medium" VARCHAR(120),
    "utm_campaign" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "activity_type" "LeadActivityType" NOT NULL,
    "notes" TEXT NOT NULL,
    "activity_date" TIMESTAMPTZ NOT NULL,
    "next_follow_up_date" DATE,
    "details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_code_key" ON "leads"("code");

-- CreateIndex
CREATE UNIQUE INDEX "leads_phone_key" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_source_idx" ON "leads"("source");

-- CreateIndex
CREATE INDEX "leads_assigned_to_idx" ON "leads"("assigned_to");

-- CreateIndex
CREATE INDEX "leads_interested_project_id_idx" ON "leads"("interested_project_id");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_activity_date_idx" ON "lead_activities"("lead_id", "activity_date");

-- CreateIndex
CREATE INDEX "lead_activities_next_follow_up_date_idx" ON "lead_activities"("next_follow_up_date");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_interested_project_id_fkey" FOREIGN KEY ("interested_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

