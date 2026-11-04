ALTER TABLE "sync_records"
    ADD COLUMN "user_id" UUID,
    ADD COLUMN "branch_id" UUID,
    ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "sync_records"
    ADD CONSTRAINT "sync_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_records"
    ADD CONSTRAINT "sync_records_branch_id_business_id_fkey"
    FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "sync_records_business_id_user_id_branch_id_updated_at_idx"
    ON "sync_records"("business_id", "user_id", "branch_id", "updated_at");
