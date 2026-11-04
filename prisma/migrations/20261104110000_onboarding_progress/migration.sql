CREATE TABLE "business_creation_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_creation_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_creation_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_creation_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_creation_requests_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "business_creation_requests_user_id_key_key" ON "business_creation_requests"("user_id", "key");
CREATE INDEX "business_creation_requests_business_id_branch_id_idx" ON "business_creation_requests"("business_id", "branch_id");

CREATE TABLE "onboarding_progress" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "financial_start_mode" VARCHAR(24),
  "skipped_steps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_progress_financial_start_mode_check" CHECK ("financial_start_mode" IS NULL OR "financial_start_mode" IN ('START_TODAY', 'EXISTING_BUSINESS')),
  CONSTRAINT "onboarding_progress_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "onboarding_progress_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "onboarding_progress_business_id_branch_id_key" ON "onboarding_progress"("business_id", "branch_id");

CREATE TABLE "onboarding_result_views" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_result_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_result_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "onboarding_result_views_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "onboarding_result_views_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "onboarding_result_views_business_id_branch_id_user_id_key" ON "onboarding_result_views"("business_id", "branch_id", "user_id");
CREATE INDEX "onboarding_result_views_user_id_viewed_at_idx" ON "onboarding_result_views"("user_id", "viewed_at");

CREATE TABLE "onboarding_events" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "business_id" UUID,
  "branch_id" UUID,
  "event_name" VARCHAR(64) NOT NULL,
  "step_name" VARCHAR(32),
  "role" "MemberRole",
  "device_type" VARCHAR(16) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_events_event_name_check" CHECK ("event_name" IN ('onboarding_started', 'auth_completed', 'business_created', 'branch_created', 'financial_start_mode_selected', 'product_created', 'first_document_posted', 'dashboard_viewed_after_first_document', 'onboarding_step_skipped', 'onboarding_resumed', 'invite_accepted', 'pwa_install_prompt_shown', 'pwa_install_prompt_accepted')),
  CONSTRAINT "onboarding_events_device_type_check" CHECK ("device_type" IN ('MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN')),
  CONSTRAINT "onboarding_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "onboarding_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "onboarding_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "onboarding_events_user_id_occurred_at_idx" ON "onboarding_events"("user_id", "occurred_at");
CREATE INDEX "onboarding_events_business_id_branch_id_occurred_at_idx" ON "onboarding_events"("business_id", "branch_id", "occurred_at");
