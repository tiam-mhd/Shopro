CREATE TABLE "storefront_customer_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(120),
    "address" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "storefront_customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_customer_profiles_phone_key" ON "storefront_customer_profiles"("phone");

WITH order_profiles AS (
    SELECT
        "customer_phone" AS phone,
        (array_agg("customer_name" ORDER BY "created_at" DESC))[1] AS full_name,
        (array_agg("delivery_address" ORDER BY "created_at" DESC)
            FILTER (WHERE "delivery_address" IS NOT NULL AND BTRIM("delivery_address") <> ''))[1] AS address,
        MIN("created_at") AS created_at
    FROM "storefront_orders"
    GROUP BY "customer_phone"
)
INSERT INTO "storefront_customer_profiles" ("phone", "full_name", "address", "created_at", "updated_at")
SELECT phone, full_name, address, created_at, CURRENT_TIMESTAMP
FROM order_profiles
ON CONFLICT ("phone") DO NOTHING;

INSERT INTO "storefront_customer_profiles" ("phone", "created_at", "updated_at")
SELECT DISTINCT "phone", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "storefront_customer_sessions"
ON CONFLICT ("phone") DO NOTHING;

ALTER TABLE "storefront_customer_sessions" ADD COLUMN "customer_id" UUID;

UPDATE "storefront_customer_sessions" AS session
SET "customer_id" = profile."id"
FROM "storefront_customer_profiles" AS profile
WHERE profile."phone" = session."phone";

ALTER TABLE "storefront_customer_sessions" ALTER COLUMN "customer_id" SET NOT NULL;

DROP INDEX "storefront_customer_sessions_storefront_id_phone_expires_at_idx";
CREATE INDEX "storefront_customer_sessions_customer_id_expires_at_idx" ON "storefront_customer_sessions"("customer_id", "expires_at");

ALTER TABLE "storefront_customer_sessions" DROP CONSTRAINT "storefront_customer_sessions_business_id_fkey";
ALTER TABLE "storefront_customer_sessions" DROP CONSTRAINT "storefront_customer_sessions_branch_id_business_id_fkey";
ALTER TABLE "storefront_customer_sessions" DROP CONSTRAINT "storefront_customer_sessions_storefront_id_branch_id_fkey";
ALTER TABLE "storefront_customer_sessions"
    ADD CONSTRAINT "storefront_customer_sessions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "storefront_customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_customer_sessions"
    DROP COLUMN "business_id",
    DROP COLUMN "branch_id",
    DROP COLUMN "storefront_id",
    DROP COLUMN "phone";
