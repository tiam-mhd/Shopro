-- CreateEnum
CREATE TYPE "StorefrontStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED');

-- CreateEnum
CREATE TYPE "StorefrontOrderStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RETURNED');

-- CreateEnum
CREATE TYPE "StorefrontPaymentStatus" AS ENUM ('NOT_DUE', 'UNPAID', 'RECEIPT_SUBMITTED', 'UNDER_REVIEW', 'PARTIALLY_VERIFIED', 'OVERPAID_REVIEW', 'VERIFIED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "StorefrontPaymentAttemptStatus" AS ENUM ('UNDER_REVIEW', 'REJECTED', 'PARTIALLY_VERIFIED', 'OVERPAID_REVIEW', 'VERIFIED');

-- CreateEnum
CREATE TYPE "StorefrontDeliveryMethod" AS ENUM ('PICKUP', 'LOCAL_DELIVERY');

-- CreateEnum
CREATE TYPE "StorefrontListingStockPolicy" AS ENUM ('EXACT', 'APPROXIMATE', 'INQUIRY');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'STOREFRONT_CHECKOUT';

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "storefront_order_id" UUID;

-- CreateTable
CREATE TABLE "storefronts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "status" "StorefrontStatus" NOT NULL DEFAULT 'DRAFT',
    "public_name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "phone" VARCHAR(20),
    "address" VARCHAR(500),
    "show_address" BOOLEAN NOT NULL DEFAULT false,
    "accepts_pickup" BOOLEAN NOT NULL DEFAULT true,
    "accepts_local_delivery" BOOLEAN NOT NULL DEFAULT false,
    "delivery_fee_rial" BIGINT NOT NULL DEFAULT 0,
    "show_exact_stock" BOOLEAN NOT NULL DEFAULT false,
    "preparation_minutes" INTEGER,
    "payment_instructions" VARCHAR(1000),
    "cancellation_policy" VARCHAR(1000),
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storefronts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_listings" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "storefront_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "public_title" VARCHAR(160),
    "public_description" VARCHAR(1000),
    "public_price_rial" BIGINT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "can_order" BOOLEAN NOT NULL DEFAULT true,
    "stock_policy" "StorefrontListingStockPolicy" NOT NULL DEFAULT 'APPROXIMATE',
    "minimum_quantity" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "maximum_quantity" DECIMAL(18,3),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storefront_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_payment_cards" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "finance_account_id" UUID NOT NULL,
    "bank_name" VARCHAR(80) NOT NULL,
    "holder_name" VARCHAR(120) NOT NULL,
    "card_number_encrypted" VARCHAR(512) NOT NULL,
    "card_last4" CHAR(4) NOT NULL,
    "label" VARCHAR(80),
    "instructions" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "store_payment_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_otp_grants" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "storefront_id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_otp_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_rate_limit_buckets" (
    "fingerprint" CHAR(64) NOT NULL,
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "storefront_rate_limit_buckets_pkey" PRIMARY KEY ("fingerprint","bucket_start")
);

-- CreateTable
CREATE TABLE "storefront_orders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "storefront_id" UUID NOT NULL,
    "public_code" VARCHAR(32) NOT NULL,
    "tracking_token_hash" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "customer_name" VARCHAR(120) NOT NULL,
    "customer_phone" VARCHAR(20) NOT NULL,
    "customer_party_id" UUID,
    "delivery_method" "StorefrontDeliveryMethod" NOT NULL,
    "delivery_address" VARCHAR(500),
    "customer_note" VARCHAR(500),
    "status" "StorefrontOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "payment_status" "StorefrontPaymentStatus" NOT NULL DEFAULT 'NOT_DUE',
    "subtotal_rial" BIGINT NOT NULL,
    "tax_rial" BIGINT NOT NULL,
    "delivery_fee_rial" BIGINT NOT NULL,
    "total_rial" BIGINT NOT NULL,
    "payment_due_at" TIMESTAMPTZ(6),
    "reservation_expires_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storefront_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_order_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "listing_id" UUID,
    "product_id" UUID,
    "title_snapshot" VARCHAR(160) NOT NULL,
    "sku_snapshot" VARCHAR(48),
    "unit_code_snapshot" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price_rial" BIGINT NOT NULL,
    "tax_rate_basis_points" INTEGER NOT NULL,
    "tax_rial" BIGINT NOT NULL,
    "line_total_rial" BIGINT NOT NULL,

    CONSTRAINT "storefront_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_payment_attempts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "card_id" UUID,
    "card_snapshot" JSONB NOT NULL,
    "submitted_amount_rial" BIGINT NOT NULL,
    "customer_transaction_reference" VARCHAR(120),
    "submission_note" VARCHAR(300),
    "verified_amount_rial" BIGINT,
    "transaction_reference" VARCHAR(120),
    "transferred_at" TIMESTAMPTZ(6),
    "status" "StorefrontPaymentAttemptStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" VARCHAR(500),
    "cash_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_receipts" (
    "id" UUID NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "storage_key" VARCHAR(80) NOT NULL,
    "mime_type" VARCHAR(80) NOT NULL,
    "bytes" BIGINT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_order_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "previous_status" "StorefrontOrderStatus",
    "new_status" "StorefrontOrderStatus" NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(500),
    "customer_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_reservations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storefront_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_branch_id_key" ON "storefronts"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_slug_key" ON "storefronts"("slug");

-- CreateIndex
CREATE INDEX "storefronts_status_updated_at_idx" ON "storefronts"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_id_branch_id_key" ON "storefronts"("id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_id_business_id_key" ON "storefronts"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_branch_id_business_id_key" ON "storefronts"("branch_id", "business_id");

-- CreateIndex
CREATE INDEX "storefront_listings_storefront_id_is_published_display_orde_idx" ON "storefront_listings"("storefront_id", "is_published", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_listings_branch_id_product_id_key" ON "storefront_listings"("branch_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_listings_id_business_id_branch_id_key" ON "storefront_listings"("id", "business_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_listings_id_business_id_key" ON "storefront_listings"("id", "business_id");

-- CreateIndex
CREATE INDEX "store_payment_cards_business_id_branch_id_is_active_display_idx" ON "store_payment_cards"("business_id", "branch_id", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "store_payment_cards_id_business_id_key" ON "store_payment_cards"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_otp_grants_token_hash_key" ON "storefront_otp_grants"("token_hash");

-- CreateIndex
CREATE INDEX "storefront_otp_grants_storefront_id_phone_expires_at_idx" ON "storefront_otp_grants"("storefront_id", "phone", "expires_at");

-- CreateIndex
CREATE INDEX "storefront_rate_limit_buckets_bucket_start_idx" ON "storefront_rate_limit_buckets"("bucket_start");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_orders_public_code_key" ON "storefront_orders"("public_code");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_orders_tracking_token_hash_key" ON "storefront_orders"("tracking_token_hash");

-- CreateIndex
CREATE INDEX "storefront_orders_business_id_branch_id_status_created_at_idx" ON "storefront_orders"("business_id", "branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "storefront_orders_business_id_branch_id_payment_status_crea_idx" ON "storefront_orders"("business_id", "branch_id", "payment_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_orders_business_id_branch_id_idempotency_key_key" ON "storefront_orders"("business_id", "branch_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_orders_id_business_id_branch_id_key" ON "storefront_orders"("id", "business_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_orders_id_business_id_key" ON "storefront_orders"("id", "business_id");

-- CreateIndex
CREATE INDEX "storefront_order_items_business_id_order_id_idx" ON "storefront_order_items"("business_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_payment_attempts_cash_transaction_id_key" ON "storefront_payment_attempts"("cash_transaction_id");

-- CreateIndex
CREATE INDEX "storefront_payment_attempts_business_id_branch_id_status_cr_idx" ON "storefront_payment_attempts"("business_id", "branch_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "storefront_payment_attempts_order_id_created_at_idx" ON "storefront_payment_attempts"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_payment_attempts_business_id_transaction_referen_key" ON "storefront_payment_attempts"("business_id", "transaction_reference");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_payment_attempts_cash_transaction_id_business_id_key" ON "storefront_payment_attempts"("cash_transaction_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_receipts_payment_attempt_id_key" ON "storefront_receipts"("payment_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_receipts_storage_key_key" ON "storefront_receipts"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_receipts_checksum_key" ON "storefront_receipts"("checksum");

-- CreateIndex
CREATE INDEX "storefront_order_events_business_id_branch_id_order_id_crea_idx" ON "storefront_order_events"("business_id", "branch_id", "order_id", "created_at");

-- CreateIndex
CREATE INDEX "storefront_reservations_business_id_branch_id_product_id_ex_idx" ON "storefront_reservations"("business_id", "branch_id", "product_id", "expires_at", "released_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_reservations_order_id_product_id_key" ON "storefront_reservations"("order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_storefront_order_id_key" ON "sales_invoices"("storefront_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_storefront_order_id_business_id_key" ON "sales_invoices"("storefront_order_id", "business_id");

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_listings" ADD CONSTRAINT "storefront_listings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_listings" ADD CONSTRAINT "storefront_listings_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_listings" ADD CONSTRAINT "storefront_listings_storefront_id_branch_id_fkey" FOREIGN KEY ("storefront_id", "branch_id") REFERENCES "storefronts"("id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_listings" ADD CONSTRAINT "storefront_listings_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_payment_cards" ADD CONSTRAINT "store_payment_cards_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_payment_cards" ADD CONSTRAINT "store_payment_cards_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_payment_cards" ADD CONSTRAINT "store_payment_cards_finance_account_id_business_id_fkey" FOREIGN KEY ("finance_account_id", "business_id") REFERENCES "finance_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_otp_grants" ADD CONSTRAINT "storefront_otp_grants_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_otp_grants" ADD CONSTRAINT "storefront_otp_grants_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_otp_grants" ADD CONSTRAINT "storefront_otp_grants_storefront_id_branch_id_fkey" FOREIGN KEY ("storefront_id", "branch_id") REFERENCES "storefronts"("id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_storefront_id_branch_id_fkey" FOREIGN KEY ("storefront_id", "branch_id") REFERENCES "storefronts"("id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_customer_party_id_business_id_fkey" FOREIGN KEY ("customer_party_id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_order_items" ADD CONSTRAINT "storefront_order_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_order_items" ADD CONSTRAINT "storefront_order_items_order_id_business_id_branch_id_fkey" FOREIGN KEY ("order_id", "business_id", "branch_id") REFERENCES "storefront_orders"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_order_items" ADD CONSTRAINT "storefront_order_items_listing_id_business_id_branch_id_fkey" FOREIGN KEY ("listing_id", "business_id", "branch_id") REFERENCES "storefront_listings"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_order_items" ADD CONSTRAINT "storefront_order_items_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_payment_attempts" ADD CONSTRAINT "storefront_payment_attempts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_payment_attempts" ADD CONSTRAINT "storefront_payment_attempts_order_id_business_id_branch_id_fkey" FOREIGN KEY ("order_id", "business_id", "branch_id") REFERENCES "storefront_orders"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_payment_attempts" ADD CONSTRAINT "storefront_payment_attempts_card_id_business_id_fkey" FOREIGN KEY ("card_id", "business_id") REFERENCES "store_payment_cards"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_payment_attempts" ADD CONSTRAINT "storefront_payment_attempts_cash_transaction_id_business_i_fkey" FOREIGN KEY ("cash_transaction_id", "business_id") REFERENCES "cash_transactions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_receipts" ADD CONSTRAINT "storefront_receipts_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "storefront_payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_order_events" ADD CONSTRAINT "storefront_order_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_order_events" ADD CONSTRAINT "storefront_order_events_order_id_business_id_branch_id_fkey" FOREIGN KEY ("order_id", "business_id", "branch_id") REFERENCES "storefront_orders"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_order_id_business_id_branch_id_fkey" FOREIGN KEY ("order_id", "business_id", "branch_id") REFERENCES "storefront_orders"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_storefront_order_id_business_id_fkey" FOREIGN KEY ("storefront_order_id", "business_id") REFERENCES "storefront_orders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
