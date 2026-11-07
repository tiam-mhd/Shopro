-- Keep shared contact identity in parties. Store each business role and its
-- role-specific data in a dedicated table, then constrain documents to that role.

ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_customer_id_business_id_fkey";
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_supplier_id_business_id_fkey";
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_payee_id_business_id_fkey";
ALTER TABLE "storefront_orders" DROP CONSTRAINT "storefront_orders_customer_party_id_business_id_fkey";

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "credit_limit_rial" BIGINT,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customers_credit_limit_nonnegative" CHECK ("credit_limit_rial" IS NULL OR "credit_limit_rial" >= 0)
);

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payment_terms_days" INTEGER,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "suppliers_payment_terms_range" CHECK ("payment_terms_days" IS NULL OR "payment_terms_days" BETWEEN 0 AND 3650)
);

CREATE UNIQUE INDEX "customers_id_business_id_key" ON "customers"("id", "business_id");
CREATE INDEX "customers_business_id_id_idx" ON "customers"("business_id", "id");
CREATE UNIQUE INDEX "suppliers_id_business_id_key" ON "suppliers"("id", "business_id");
CREATE INDEX "suppliers_business_id_id_idx" ON "suppliers"("business_id", "id");

-- Preserve existing role memberships and repair membership rows from any
-- historical documents that predate strict role validation.
INSERT INTO "customers" ("id", "business_id", "credit_limit_rial")
SELECT p."id", p."business_id", p."credit_limit_rial"
FROM "parties" p
WHERE p."type" IN ('CUSTOMER', 'BOTH')
   OR EXISTS (SELECT 1 FROM "sales_invoices" si WHERE si."customer_id" = p."id" AND si."business_id" = p."business_id")
   OR EXISTS (SELECT 1 FROM "storefront_orders" so WHERE so."customer_party_id" = p."id" AND so."business_id" = p."business_id");

INSERT INTO "suppliers" ("id", "business_id", "payment_terms_days")
SELECT p."id", p."business_id", NULL
FROM "parties" p
WHERE p."type" IN ('SUPPLIER', 'BOTH')
   OR EXISTS (SELECT 1 FROM "purchases" pu WHERE pu."supplier_id" = p."id" AND pu."business_id" = p."business_id")
   OR EXISTS (SELECT 1 FROM "expenses" e WHERE e."payee_id" = p."id" AND e."business_id" = p."business_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_id_business_id_fkey"
    FOREIGN KEY ("id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_id_business_id_fkey"
    FOREIGN KEY ("id", "business_id") REFERENCES "parties"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_business_id_fkey"
    FOREIGN KEY ("customer_id", "business_id") REFERENCES "customers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_business_id_fkey"
    FOREIGN KEY ("supplier_id", "business_id") REFERENCES "suppliers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payee_id_business_id_fkey"
    FOREIGN KEY ("payee_id", "business_id") REFERENCES "suppliers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_orders" ADD CONSTRAINT "storefront_orders_customer_party_id_business_id_fkey"
    FOREIGN KEY ("customer_party_id", "business_id") REFERENCES "customers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parties" DROP COLUMN "credit_limit_rial";
ALTER TABLE "parties" DROP COLUMN "type";
DROP TYPE "PartyType";
