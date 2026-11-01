-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DisplayCurrency" AS ENUM ('IRR', 'IRT');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('USER_LOGIN', 'ADMIN_LOGIN');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('STOCK', 'SERVICE');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceAccountKind" AS ENUM ('CASH', 'BANK', 'POS', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CashTransactionKind" AS ENUM ('RECEIPT', 'PAYMENT', 'TRANSFER', 'OPENING');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'POS', 'BANK', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CONFLICT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "displayName" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_admins" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_admin_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "request_ip_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "business_type" VARCHAR(80) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Tehran',
    "base_currency" CHAR(3) NOT NULL DEFAULT 'IRR',
    "display_currency" "DisplayCurrency" NOT NULL DEFAULT 'IRT',
    "locale" VARCHAR(12) NOT NULL DEFAULT 'fa-IR',
    "calendar" VARCHAR(12) NOT NULL DEFAULT 'jalali',
    "inventory_enabled" BOOLEAN NOT NULL DEFAULT true,
    "negative_stock_allowed" BOOLEAN NOT NULL DEFAULT false,
    "settings_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'CASHIER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_branches" (
    "member_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_branches_pkey" PRIMARY KEY ("member_id","branch_id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "label_fa" VARCHAR(40) NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sku" VARCHAR(48),
    "barcode" VARCHAR(64),
    "name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(200) NOT NULL,
    "kind" "ProductKind" NOT NULL DEFAULT 'STOCK',
    "unit_id" UUID NOT NULL,
    "category_id" UUID,
    "sale_price_rial" BIGINT NOT NULL DEFAULT 0,
    "default_cost_rial" BIGINT,
    "reorder_point" DECIMAL(18,3),
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "type" "PartyType" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "national_id" VARCHAR(20),
    "address" VARCHAR(500),
    "credit_limit_rial" BIGINT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "AccountType" NOT NULL,
    "system_key" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "FinanceAccountKind" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID,
    "invoice_no" VARCHAR(32),
    "txn_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_rial" BIGINT NOT NULL DEFAULT 0,
    "discount_rial" BIGINT NOT NULL DEFAULT 0,
    "tax_rial" BIGINT NOT NULL DEFAULT 0,
    "total_rial" BIGINT NOT NULL DEFAULT 0,
    "note" VARCHAR(1000),
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "void_reason" VARCHAR(500),
    "return_of_id" UUID,
    "return_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "return_of_line_id" UUID,
    "product_id" UUID,
    "description_snapshot" VARCHAR(200) NOT NULL,
    "sku_snapshot" VARCHAR(48),
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_code_snapshot" VARCHAR(20) NOT NULL,
    "unit_price_rial" BIGINT NOT NULL,
    "discount_rial" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "tax_rial" BIGINT NOT NULL DEFAULT 0,
    "line_total_rial" BIGINT NOT NULL,
    "cogs_rial" BIGINT,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID,
    "purchase_no" VARCHAR(32),
    "txn_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_rial" BIGINT NOT NULL DEFAULT 0,
    "discount_rial" BIGINT NOT NULL DEFAULT 0,
    "tax_rial" BIGINT NOT NULL DEFAULT 0,
    "total_rial" BIGINT NOT NULL DEFAULT 0,
    "note" VARCHAR(1000),
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "product_id" UUID,
    "description_snapshot" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost_rial" BIGINT NOT NULL,
    "discount_rial" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "tax_rial" BIGINT NOT NULL DEFAULT 0,
    "line_total_rial" BIGINT NOT NULL,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "expense_ledger_account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "payee_id" UUID,
    "attachment_id" UUID,
    "expense_no" VARCHAR(32),
    "txn_date" DATE NOT NULL,
    "amount_rial" BIGINT NOT NULL,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "tax_rial" BIGINT NOT NULL DEFAULT 0,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(1000),
    "posted_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "bytes" BIGINT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" "CashTransactionKind" NOT NULL,
    "txn_date" DATE NOT NULL,
    "amount_rial" BIGINT NOT NULL,
    "from_account_id" UUID,
    "to_account_id" UUID,
    "party_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(120),
    "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" UUID,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "finance_account_id" UUID NOT NULL,
    "close_date" DATE NOT NULL,
    "system_balance_rial" BIGINT NOT NULL,
    "counted_balance_rial" BIGINT NOT NULL,
    "difference_rial" BIGINT NOT NULL,
    "note" VARCHAR(500),
    "journal_entry_id" UUID,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "cash_transaction_id" UUID NOT NULL,
    "sales_invoice_id" UUID,
    "purchase_id" UUID,
    "amount_rial" BIGINT NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "txn_date" DATE NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "source_id" UUID NOT NULL,
    "quantity_delta" DECIMAL(18,3) NOT NULL,
    "unit_cost_rial" BIGINT NOT NULL,
    "value_delta_rial" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_on_hand" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "inventory_value_rial" BIGINT NOT NULL DEFAULT 0,
    "average_cost_rial" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "txn_date" DATE NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(500) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "counted_quantity" DECIMAL(18,3) NOT NULL,
    "system_quantity_snapshot" DECIMAL(18,3) NOT NULL,
    "delta_quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "entry_no" VARCHAR(32) NOT NULL,
    "txn_date" DATE NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "source_id" UUID NOT NULL,
    "memo" VARCHAR(500),
    "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
    "reversal_of_id" UUID,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by" UUID NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "party_id" UUID,
    "branch_id" UUID NOT NULL,
    "debit_rial" BIGINT NOT NULL DEFAULT 0,
    "credit_rial" BIGINT NOT NULL DEFAULT 0,
    "description" VARCHAR(300),

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closed_periods" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "close_reason" VARCHAR(500) NOT NULL,
    "closed_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopened_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopen_reason" VARCHAR(500),

    CONSTRAINT "closed_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID NOT NULL,
    "request_id" VARCHAR(80) NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_records" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "device_id" VARCHAR(120) NOT NULL,
    "client_operation_id" UUID NOT NULL,
    "operation_type" VARCHAR(60) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "server_entity_id" UUID,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "system_admins_phone_key" ON "system_admins"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_admin_sessions_token_hash_key" ON "system_admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "system_admin_sessions_admin_id_expires_at_idx" ON "system_admin_sessions"("admin_id", "expires_at");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_purpose_created_at_idx" ON "otp_challenges"("phone", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "business_members_user_id_status_idx" ON "business_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_business_id_user_id_key" ON "business_members"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_id_business_id_key" ON "business_members"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_business_id_code_key" ON "branches"("business_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_business_id_key" ON "branches"("id", "business_id");

-- CreateIndex
CREATE INDEX "member_branches_business_id_branch_id_idx" ON "member_branches"("business_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_business_id_code_key" ON "units"("business_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "units_id_business_id_key" ON "units"("id", "business_id");

-- CreateIndex
CREATE INDEX "product_categories_business_id_is_active_idx" ON "product_categories"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_id_business_id_key" ON "product_categories"("id", "business_id");

-- CreateIndex
CREATE INDEX "products_business_id_is_active_normalized_name_idx" ON "products"("business_id", "is_active", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_business_id_key" ON "products"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "products"("business_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_barcode_key" ON "products"("business_id", "barcode");

-- CreateIndex
CREATE INDEX "parties_business_id_normalized_name_idx" ON "parties"("business_id", "normalized_name");

-- CreateIndex
CREATE INDEX "parties_business_id_phone_idx" ON "parties"("business_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "parties_id_business_id_key" ON "parties"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_id_business_id_key" ON "ledger_accounts"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_business_id_code_key" ON "ledger_accounts"("business_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_business_id_system_key_key" ON "ledger_accounts"("business_id", "system_key");

-- CreateIndex
CREATE INDEX "finance_accounts_business_id_branch_id_is_active_idx" ON "finance_accounts"("business_id", "branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "finance_accounts_id_business_id_key" ON "finance_accounts"("id", "business_id");

-- CreateIndex
CREATE INDEX "sales_invoices_business_id_branch_id_txn_date_status_idx" ON "sales_invoices"("business_id", "branch_id", "txn_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_business_id_invoice_no_key" ON "sales_invoices"("business_id", "invoice_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_id_business_id_key" ON "sales_invoices"("id", "business_id");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_business_id_invoice_id_idx" ON "sales_invoice_lines"("business_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_lines_id_business_id_key" ON "sales_invoice_lines"("id", "business_id");

-- CreateIndex
CREATE INDEX "purchases_business_id_branch_id_txn_date_status_idx" ON "purchases"("business_id", "branch_id", "txn_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_business_id_purchase_no_key" ON "purchases"("business_id", "purchase_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_id_business_id_key" ON "purchases"("id", "business_id");

-- CreateIndex
CREATE INDEX "purchase_lines_business_id_purchase_id_idx" ON "purchase_lines"("business_id", "purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_id_business_id_key" ON "expense_categories"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_business_id_name_key" ON "expense_categories"("business_id", "name");

-- CreateIndex
CREATE INDEX "expenses_business_id_branch_id_txn_date_status_idx" ON "expenses"("business_id", "branch_id", "txn_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_business_id_expense_no_key" ON "expenses"("business_id", "expense_no");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_id_business_id_key" ON "expenses"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_id_business_id_key" ON "attachments"("id", "business_id");

-- CreateIndex
CREATE INDEX "cash_transactions_business_id_branch_id_txn_date_idx" ON "cash_transactions"("business_id", "branch_id", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_id_business_id_key" ON "cash_transactions"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_business_id_idempotency_key_key" ON "cash_transactions"("business_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "cash_closes_business_id_branch_id_close_date_idx" ON "cash_closes"("business_id", "branch_id", "close_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closes_business_id_idempotency_key_key" ON "cash_closes"("business_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_allocations_business_id_sales_invoice_id_idx" ON "payment_allocations"("business_id", "sales_invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_business_id_purchase_id_idx" ON "payment_allocations"("business_id", "purchase_id");

-- CreateIndex
CREATE INDEX "inventory_movements_business_id_branch_id_product_id_txn_da_idx" ON "inventory_movements"("business_id", "branch_id", "product_id", "txn_date");

-- CreateIndex
CREATE INDEX "inventory_movements_business_id_source_type_source_id_idx" ON "inventory_movements"("business_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_business_id_branch_id_product_id_key" ON "inventory_balances"("business_id", "branch_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_id_business_id_key" ON "stock_counts"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stock_count_id_product_id_key" ON "stock_count_lines"("stock_count_id", "product_id");

-- CreateIndex
CREATE INDEX "journal_entries_business_id_branch_id_txn_date_idx" ON "journal_entries"("business_id", "branch_id", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_id_business_id_key" ON "journal_entries"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_business_id_source_type_source_id_key" ON "journal_entries"("business_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_business_id_entry_no_key" ON "journal_entries"("business_id", "entry_no");

-- CreateIndex
CREATE INDEX "journal_lines_business_id_ledger_account_id_branch_id_idx" ON "journal_lines"("business_id", "ledger_account_id", "branch_id");

-- CreateIndex
CREATE INDEX "closed_periods_business_id_start_date_end_date_idx" ON "closed_periods"("business_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "audit_events_business_id_occurred_at_idx" ON "audit_events"("business_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_business_id_entity_type_entity_id_idx" ON "audit_events"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_business_id_user_id_key_key" ON "idempotency_records"("business_id", "user_id", "key");

-- CreateIndex
CREATE INDEX "sync_records_business_id_status_created_at_idx" ON "sync_records"("business_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_records_business_id_device_id_client_operation_id_key" ON "sync_records"("business_id", "device_id", "client_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_business_id_branch_id_type_key" ON "document_sequences"("business_id", "branch_id", "type");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_admin_sessions" ADD CONSTRAINT "system_admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "system_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_branches" ADD CONSTRAINT "member_branches_member_id_business_id_fkey" FOREIGN KEY ("member_id", "business_id") REFERENCES "business_members"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_branches" ADD CONSTRAINT "member_branches_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_business_id_fkey" FOREIGN KEY ("parent_id", "business_id") REFERENCES "product_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_business_id_fkey" FOREIGN KEY ("unit_id", "business_id") REFERENCES "units"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "product_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parent_id_business_id_fkey" FOREIGN KEY ("parent_id", "business_id") REFERENCES "ledger_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_ledger_account_id_business_id_fkey" FOREIGN KEY ("ledger_account_id", "business_id") REFERENCES "ledger_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_business_id_fkey" FOREIGN KEY ("customer_id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_return_of_id_business_id_fkey" FOREIGN KEY ("return_of_id", "business_id") REFERENCES "sales_invoices"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_business_id_fkey" FOREIGN KEY ("invoice_id", "business_id") REFERENCES "sales_invoices"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_return_of_line_id_business_id_fkey" FOREIGN KEY ("return_of_line_id", "business_id") REFERENCES "sales_invoice_lines"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_business_id_fkey" FOREIGN KEY ("supplier_id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_business_id_fkey" FOREIGN KEY ("purchase_id", "business_id") REFERENCES "purchases"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_expense_ledger_account_id_business_id_fkey" FOREIGN KEY ("expense_ledger_account_id", "business_id") REFERENCES "ledger_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "expense_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payee_id_business_id_fkey" FOREIGN KEY ("payee_id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_attachment_id_business_id_fkey" FOREIGN KEY ("attachment_id", "business_id") REFERENCES "attachments"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_from_account_id_business_id_fkey" FOREIGN KEY ("from_account_id", "business_id") REFERENCES "finance_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_to_account_id_business_id_fkey" FOREIGN KEY ("to_account_id", "business_id") REFERENCES "finance_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_party_id_business_id_fkey" FOREIGN KEY ("party_id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_journal_entry_id_business_id_fkey" FOREIGN KEY ("journal_entry_id", "business_id") REFERENCES "journal_entries"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_finance_account_id_business_id_fkey" FOREIGN KEY ("finance_account_id", "business_id") REFERENCES "finance_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_journal_entry_id_business_id_fkey" FOREIGN KEY ("journal_entry_id", "business_id") REFERENCES "journal_entries"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_cash_transaction_id_business_id_fkey" FOREIGN KEY ("cash_transaction_id", "business_id") REFERENCES "cash_transactions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_sales_invoice_id_business_id_fkey" FOREIGN KEY ("sales_invoice_id", "business_id") REFERENCES "sales_invoices"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_purchase_id_business_id_fkey" FOREIGN KEY ("purchase_id", "business_id") REFERENCES "purchases"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_business_id_fkey" FOREIGN KEY ("stock_count_id", "business_id") REFERENCES "stock_counts"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_business_id_fkey" FOREIGN KEY ("journal_entry_id", "business_id") REFERENCES "journal_entries"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_ledger_account_id_business_id_fkey" FOREIGN KEY ("ledger_account_id", "business_id") REFERENCES "ledger_accounts"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_id_business_id_fkey" FOREIGN KEY ("party_id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closed_periods" ADD CONSTRAINT "closed_periods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
