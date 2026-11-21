ALTER TABLE "users"
    ADD COLUMN "trial_started_at" TIMESTAMPTZ(6),
    ADD COLUMN "trial_ends_at" TIMESTAMPTZ(6),
    ADD COLUMN "trial_business_id" UUID;

CREATE UNIQUE INDEX "users_trial_business_id_key"
    ON "users"("trial_business_id");

ALTER TABLE "users"
    ADD CONSTRAINT "users_trial_business_id_fkey"
    FOREIGN KEY ("trial_business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "users_trial_dates_check"
    CHECK (("trial_started_at" IS NULL) = ("trial_ends_at" IS NULL) AND ("trial_started_at" IS NULL OR "trial_ends_at" > "trial_started_at"));

INSERT INTO "subscription_rollout_settings" ("id", "mode", "legacy_grace_ends_at", "updated_at")
VALUES ('global', 'ENFORCE', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET "mode" = 'ENFORCE', "legacy_grace_ends_at" = NULL, "updated_at" = CURRENT_TIMESTAMP;
