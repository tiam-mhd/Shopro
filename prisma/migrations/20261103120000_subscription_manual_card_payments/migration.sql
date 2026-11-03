CREATE TYPE "ManualPaymentReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'SENT', 'FAILED');

ALTER TABLE "subscription_orders"
ADD COLUMN "manual_payment_settings_snapshot" JSONB;

CREATE TABLE "subscription_manual_payment_settings" (
  "id" VARCHAR(16) NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "card_number" VARCHAR(32) NOT NULL DEFAULT '6219861995926549',
  "card_holder" VARCHAR(120) NOT NULL DEFAULT 'محمدصالح محمدی',
  "bank_name" VARCHAR(80),
  "instructions" VARCHAR(1000),
  "telegram_contact_handle" VARCHAR(64) NOT NULL DEFAULT '@tiaammhd',
  "telegram_target_chat_id" VARCHAR(80),
  "updated_by_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_manual_payment_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_manual_payment_submissions" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "payment_attempt_id" UUID NOT NULL,
  "submitted_by_id" UUID NOT NULL,
  "review_status" "ManualPaymentReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "tracking_code" VARCHAR(120),
  "storage_key" VARCHAR(500) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "bytes" BIGINT NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "telegram_status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "telegram_message_id" VARCHAR(40),
  "telegram_error_code" VARCHAR(80),
  "reviewed_by_admin_id" UUID,
  "rejection_reason" VARCHAR(500),
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  CONSTRAINT "subscription_manual_payment_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_payment_attempts_id_order_id_key"
ON "subscription_payment_attempts"("id", "order_id");
CREATE UNIQUE INDEX "subscription_manual_payment_submissions_payment_attempt_id_key"
ON "subscription_manual_payment_submissions"("payment_attempt_id");
CREATE UNIQUE INDEX "subscription_manual_payment_submissions_payment_attempt_id_order_id_key"
ON "subscription_manual_payment_submissions"("payment_attempt_id", "order_id");
CREATE UNIQUE INDEX "subscription_manual_payment_submissions_storage_key_key"
ON "subscription_manual_payment_submissions"("storage_key");
CREATE INDEX "subscription_manual_payment_submissions_review_status_submitted_at_idx"
ON "subscription_manual_payment_submissions"("review_status", "submitted_at");
CREATE INDEX "subscription_manual_payment_submissions_order_id_submitted_at_idx"
ON "subscription_manual_payment_submissions"("order_id", "submitted_at");

ALTER TABLE "subscription_manual_payment_settings"
ADD CONSTRAINT "subscription_manual_payment_settings_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "system_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subscription_manual_payment_submissions"
ADD CONSTRAINT "subscription_manual_payment_submissions_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "subscription_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "subscription_manual_payment_submissions_payment_attempt_id_order_id_fkey"
FOREIGN KEY ("payment_attempt_id", "order_id") REFERENCES "subscription_payment_attempts"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "subscription_manual_payment_submissions_submitted_by_id_fkey"
FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "subscription_manual_payment_submissions_reviewed_by_admin_id_fkey"
FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "system_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "subscription_manual_payment_submissions_bytes_check" CHECK ("bytes" > 0);

INSERT INTO "subscription_manual_payment_settings" (
  "id", "enabled", "card_number", "card_holder", "telegram_contact_handle"
) VALUES (
  'global', true, '6219861995926549', 'محمدصالح محمدی', '@tiaammhd'
);
