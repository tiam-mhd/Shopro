CREATE TYPE "SubscriptionRolloutMode" AS ENUM ('OBSERVE', 'ENFORCE');
CREATE TYPE "SubscriptionOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('INITIATED', 'SUCCEEDED', 'FAILED', 'UNAVAILABLE', 'REFUNDED');
CREATE TYPE "SubscriptionPeriodSource" AS ENUM ('PAID_ORDER', 'ADMIN_GRANT', 'ADMIN_EXTENSION', 'COMPENSATION');

CREATE TABLE "subscription_plans" (
  "id" UUID NOT NULL,
  "code" VARCHAR(24) NOT NULL,
  "name_fa" VARCHAR(80) NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "badge" VARCHAR(80),
  "features" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");
CREATE INDEX "subscription_plans_is_active_display_order_idx" ON "subscription_plans"("is_active", "display_order");

CREATE TABLE "subscription_price_versions" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "duration_months" INTEGER NOT NULL,
  "price_rial" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'IRR',
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_to" TIMESTAMPTZ(6),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_price_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_price_versions_duration_months_check" CHECK ("duration_months" IN (1, 3, 6, 12)),
  CONSTRAINT "subscription_price_versions_price_rial_check" CHECK ("price_rial" >= 0),
  CONSTRAINT "subscription_price_versions_effective_range_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
CREATE UNIQUE INDEX "subscription_price_versions_plan_id_duration_months_effective_from_key" ON "subscription_price_versions"("plan_id", "duration_months", "effective_from");

CREATE TABLE "branch_subscriptions" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "suspended_at" TIMESTAMPTZ(6),
  "suspension_reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "branch_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branch_subscriptions_business_id_branch_id_key" ON "branch_subscriptions"("business_id", "branch_id");
CREATE UNIQUE INDEX "branch_subscriptions_id_business_id_branch_id_key" ON "branch_subscriptions"("id", "business_id", "branch_id");
CREATE INDEX "branch_subscriptions_business_id_updated_at_idx" ON "branch_subscriptions"("business_id", "updated_at");

CREATE TABLE "subscription_orders" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "branch_subscription_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "price_version_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "plan_code_snapshot" VARCHAR(24) NOT NULL,
  "plan_name_fa_snapshot" VARCHAR(80) NOT NULL,
  "duration_months" INTEGER NOT NULL,
  "amount_rial" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'IRR',
  "status" "SubscriptionOrderStatus" NOT NULL DEFAULT 'PENDING',
  "provider_reference" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "paid_at" TIMESTAMPTZ(6),
  CONSTRAINT "subscription_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_orders_duration_months_check" CHECK ("duration_months" IN (1, 3, 6, 12)),
  CONSTRAINT "subscription_orders_amount_rial_check" CHECK ("amount_rial" >= 0)
);
CREATE UNIQUE INDEX "subscription_orders_provider_reference_key" ON "subscription_orders"("provider_reference");
CREATE UNIQUE INDEX "subscription_orders_business_id_branch_id_idempotency_key_key" ON "subscription_orders"("business_id", "branch_id", "idempotency_key");
CREATE UNIQUE INDEX "subscription_orders_id_business_id_branch_id_key" ON "subscription_orders"("id", "business_id", "branch_id");
CREATE INDEX "subscription_orders_business_id_branch_id_created_at_idx" ON "subscription_orders"("business_id", "branch_id", "created_at");
CREATE INDEX "subscription_orders_status_created_at_idx" ON "subscription_orders"("status", "created_at");

CREATE TABLE "subscription_periods" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "branch_subscription_id" UUID NOT NULL,
  "order_id" UUID,
  "plan_id" UUID,
  "source" "SubscriptionPeriodSource" NOT NULL,
  "plan_code_snapshot" VARCHAR(24),
  "plan_name_fa_snapshot" VARCHAR(80),
  "duration_months" INTEGER,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "revocation_reason" VARCHAR(500),
  "actor_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_periods_range_check" CHECK ("ends_at" > "starts_at")
);
CREATE INDEX "subscription_periods_business_id_branch_id_starts_at_ends_at_idx" ON "subscription_periods"("business_id", "branch_id", "starts_at", "ends_at");
CREATE UNIQUE INDEX "subscription_periods_order_id_key" ON "subscription_periods"("order_id");

CREATE TABLE "subscription_payment_attempts" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "provider_external_id" VARCHAR(160),
  "amount_rial" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'IRR',
  "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'INITIATED',
  "safe_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "subscription_payment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_payment_attempts_amount_rial_check" CHECK ("amount_rial" >= 0)
);
CREATE UNIQUE INDEX "subscription_payment_attempts_provider_external_id_key" ON "subscription_payment_attempts"("provider_external_id");
CREATE INDEX "subscription_payment_attempts_business_id_branch_id_created_at_idx" ON "subscription_payment_attempts"("business_id", "branch_id", "created_at");
CREATE INDEX "subscription_payment_attempts_order_id_created_at_idx" ON "subscription_payment_attempts"("order_id", "created_at");

CREATE TABLE "subscription_rollout_settings" (
  "id" VARCHAR(16) NOT NULL DEFAULT 'global',
  "mode" "SubscriptionRolloutMode" NOT NULL DEFAULT 'OBSERVE',
  "legacy_grace_ends_at" TIMESTAMPTZ(6),
  "provider_fee_basis_points" INTEGER,
  "tax_rate_basis_points" INTEGER,
  "variable_cost_rial" BIGINT,
  "minimum_contribution_rial" BIGINT,
  "updated_by_id" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "subscription_rollout_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_rollout_settings_singleton_check" CHECK ("id" = 'global'),
  CONSTRAINT "subscription_rollout_settings_rates_check" CHECK (("provider_fee_basis_points" IS NULL OR "provider_fee_basis_points" BETWEEN 0 AND 10000) AND ("tax_rate_basis_points" IS NULL OR "tax_rate_basis_points" BETWEEN 0 AND 10000)),
  CONSTRAINT "subscription_rollout_settings_costs_check" CHECK (("variable_cost_rial" IS NULL OR "variable_cost_rial" >= 0) AND ("minimum_contribution_rial" IS NULL OR "minimum_contribution_rial" >= 0))
);

ALTER TABLE "subscription_price_versions" ADD CONSTRAINT "subscription_price_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_price_versions" ADD CONSTRAINT "subscription_price_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "system_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_subscriptions" ADD CONSTRAINT "branch_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_subscriptions" ADD CONSTRAINT "branch_subscriptions_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_branch_subscription_id_business_id_branch_id_fkey" FOREIGN KEY ("branch_subscription_id", "business_id", "branch_id") REFERENCES "branch_subscriptions"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "subscription_price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_branch_subscription_id_business_id_branch_id_fkey" FOREIGN KEY ("branch_subscription_id", "business_id", "branch_id") REFERENCES "branch_subscriptions"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "subscription_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "system_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscription_payment_attempts" ADD CONSTRAINT "subscription_payment_attempts_order_id_business_id_branch_id_fkey" FOREIGN KEY ("order_id", "business_id", "branch_id") REFERENCES "subscription_orders"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_rollout_settings" ADD CONSTRAINT "subscription_rollout_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "system_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
