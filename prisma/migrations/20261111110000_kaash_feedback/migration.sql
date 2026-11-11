CREATE TYPE "KaashStatus" AS ENUM (
  'NEW',
  'REVIEWING',
  'PLANNED',
  'IN_PROGRESS',
  'RELEASED',
  'ARCHIVED'
);

CREATE TYPE "KaashModule" AS ENUM (
  'DASHBOARD',
  'ONBOARDING',
  'SUBSCRIPTIONS',
  'STOREFRONT',
  'SALES',
  'INVOICES',
  'CUSTOMERS',
  'SUPPLIERS',
  'PRODUCTS',
  'SERVICES',
  'INVENTORY',
  'PURCHASES',
  'EXPENSES',
  'FINANCE',
  'LEDGER',
  'REPORTS',
  'SETTINGS',
  'OTHER'
);

CREATE TYPE "KaashEventKind" AS ENUM ('SUBMITTED', 'STATUS_CHANGED', 'NOTE_CHANGED', 'ADMIN_UPDATED');

CREATE TABLE "kaash_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "business_id" UUID,
  "branch_id" UUID,
  "client_submission_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "source_module" "KaashModule" NOT NULL,
  "screen_key" VARCHAR(64) NOT NULL,
  "status" "KaashStatus" NOT NULL DEFAULT 'NEW',
  "internal_note" TEXT,
  "last_updated_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "kaash_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kaash_submissions_content_length_check" CHECK (char_length("content") BETWEEN 1 AND 1000),
  CONSTRAINT "kaash_submissions_content_nonblank_check" CHECK (length(btrim("content")) > 0),
  CONSTRAINT "kaash_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "kaash_submissions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "kaash_submissions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "kaash_submissions_last_updated_by_admin_id_fkey" FOREIGN KEY ("last_updated_by_admin_id") REFERENCES "system_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "kaash_submission_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "admin_id" UUID,
  "kind" "KaashEventKind" NOT NULL,
  "previous_status" "KaashStatus",
  "new_status" "KaashStatus",
  "previous_note" TEXT,
  "new_note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kaash_submission_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kaash_submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "kaash_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "kaash_submission_events_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "system_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "kaash_submissions_user_id_client_submission_id_key" ON "kaash_submissions"("user_id", "client_submission_id");
CREATE INDEX "kaash_submissions_user_id_created_at_idx" ON "kaash_submissions"("user_id", "created_at" DESC);
CREATE INDEX "kaash_submissions_business_id_created_at_idx" ON "kaash_submissions"("business_id", "created_at" DESC);
CREATE INDEX "kaash_submissions_status_created_at_idx" ON "kaash_submissions"("status", "created_at" DESC);
CREATE INDEX "kaash_submissions_source_module_created_at_idx" ON "kaash_submissions"("source_module", "created_at" DESC);
CREATE INDEX "kaash_submission_events_submission_id_created_at_idx" ON "kaash_submission_events"("submission_id", "created_at" DESC);
CREATE INDEX "kaash_submission_events_admin_id_created_at_idx" ON "kaash_submission_events"("admin_id", "created_at" DESC);
