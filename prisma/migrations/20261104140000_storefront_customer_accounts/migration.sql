ALTER TYPE "OtpPurpose" ADD VALUE 'STOREFRONT_CUSTOMER';

CREATE TABLE "storefront_customer_sessions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "storefront_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_customer_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_customer_sessions_token_hash_key" ON "storefront_customer_sessions"("token_hash");
CREATE INDEX "storefront_customer_sessions_storefront_id_phone_expires_at_idx" ON "storefront_customer_sessions"("storefront_id", "phone", "expires_at");
CREATE INDEX "storefront_customer_sessions_expires_at_idx" ON "storefront_customer_sessions"("expires_at");

ALTER TABLE "storefront_customer_sessions" ADD CONSTRAINT "storefront_customer_sessions_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_customer_sessions" ADD CONSTRAINT "storefront_customer_sessions_branch_id_business_id_fkey"
    FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_customer_sessions" ADD CONSTRAINT "storefront_customer_sessions_storefront_id_branch_id_fkey"
    FOREIGN KEY ("storefront_id", "branch_id") REFERENCES "storefronts"("id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
