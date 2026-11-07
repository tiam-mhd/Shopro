-- Preserve catalog identifiers while splitting shared item data from product- and service-only data.
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_product_id_business_id_fkey";
ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_product_id_business_id_fkey";
ALTER TABLE "storefront_listings" DROP CONSTRAINT "storefront_listings_product_id_business_id_fkey";
ALTER TABLE "storefront_order_items" DROP CONSTRAINT "storefront_order_items_product_id_business_id_fkey";
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_product_id_business_id_fkey";
ALTER TABLE "inventory_balances" DROP CONSTRAINT "inventory_balances_product_id_business_id_fkey";
ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_product_id_business_id_fkey";
ALTER TABLE "storefront_reservations" DROP CONSTRAINT "storefront_reservations_product_id_business_id_fkey";
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_product_id_business_id_fkey";

ALTER TABLE "products" RENAME TO "products_legacy";
ALTER INDEX "products_pkey" RENAME TO "products_legacy_pkey";
ALTER INDEX "products_id_business_id_key" RENAME TO "products_legacy_id_business_id_key";
ALTER INDEX "products_business_id_sku_key" RENAME TO "products_legacy_business_id_sku_key";
ALTER INDEX "products_business_id_barcode_key" RENAME TO "products_legacy_business_id_barcode_key";
ALTER INDEX "products_business_id_is_active_normalized_name_idx" RENAME TO "products_legacy_business_id_is_active_normalized_name_idx";
ALTER TABLE "products_legacy" DROP CONSTRAINT "products_business_id_fkey";
ALTER TABLE "products_legacy" DROP CONSTRAINT "products_unit_id_business_id_fkey";
ALTER TABLE "products_legacy" DROP CONSTRAINT "products_category_id_business_id_fkey";

CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(200) NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "unit_id" UUID NOT NULL,
    "sale_price_rial" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_items_id_business_id_key" ON "catalog_items"("id", "business_id");
CREATE INDEX "catalog_items_business_id_kind_is_active_normalized_name_idx" ON "catalog_items"("business_id", "kind", "is_active", "normalized_name");

INSERT INTO "catalog_items" (
    "id", "business_id", "name", "normalized_name", "kind", "unit_id", "sale_price_rial",
    "tax_rate_basis_points", "is_active", "archived_at", "created_at", "updated_at"
)
SELECT "id", "business_id", "name", "normalized_name", "kind", "unit_id", "sale_price_rial",
       "tax_rate_basis_points", "is_active", "archived_at", "created_at", "updated_at"
FROM "products_legacy";

CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_categories_id_business_id_key" ON "service_categories"("id", "business_id");
CREATE INDEX "service_categories_business_id_is_active_idx" ON "service_categories"("business_id", "is_active");
INSERT INTO "service_categories" ("id", "business_id", "parent_id", "name", "is_active")
SELECT "id", "business_id", "parent_id", "name", "is_active" FROM "product_categories";

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sku" VARCHAR(48),
    "barcode" VARCHAR(64),
    "category_id" UUID,
    "default_cost_rial" BIGINT,
    "reorder_point" DECIMAL(18,3),
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "products_id_business_id_key" ON "products"("id", "business_id");
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "products"("business_id", "sku");
CREATE UNIQUE INDEX "products_business_id_barcode_key" ON "products"("business_id", "barcode");
CREATE INDEX "products_business_id_category_id_idx" ON "products"("business_id", "category_id");
INSERT INTO "products" ("id", "business_id", "sku", "barcode", "category_id", "default_cost_rial", "reorder_point", "track_inventory")
SELECT "id", "business_id", "sku", "barcode", "category_id", "default_cost_rial", "reorder_point", "track_inventory"
FROM "products_legacy" WHERE "kind" = 'STOCK';

CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "category_id" UUID,
    "description" VARCHAR(1000),
    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "services_id_business_id_key" ON "services"("id", "business_id");
CREATE INDEX "services_business_id_category_id_idx" ON "services"("business_id", "category_id");
INSERT INTO "services" ("id", "business_id", "category_id")
SELECT "id", "business_id", "category_id" FROM "products_legacy" WHERE "kind" = 'SERVICE';

CREATE TABLE "service_images" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_images_business_id_branch_id_service_id_position_key" ON "service_images"("business_id", "branch_id", "service_id", "position");
CREATE INDEX "service_images_business_id_branch_id_service_id_idx" ON "service_images"("business_id", "branch_id", "service_id");
INSERT INTO "service_images" ("id", "business_id", "branch_id", "service_id", "position", "bytes", "checksum", "created_at")
SELECT images."id", images."business_id", images."branch_id", images."product_id", images."position", images."bytes", images."checksum", images."created_at"
FROM "product_images" AS images
JOIN "products_legacy" AS legacy ON legacy."id" = images."product_id" AND legacy."business_id" = images."business_id"
WHERE legacy."kind" = 'SERVICE';
DELETE FROM "product_images" AS images
USING "products_legacy" AS legacy
WHERE legacy."id" = images."product_id" AND legacy."business_id" = images."business_id" AND legacy."kind" = 'SERVICE';

ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_unit_id_business_id_fkey" FOREIGN KEY ("unit_id", "business_id") REFERENCES "units"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_parent_id_business_id_fkey" FOREIGN KEY ("parent_id", "business_id") REFERENCES "service_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_id_business_id_fkey" FOREIGN KEY ("id", "business_id") REFERENCES "catalog_items"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "product_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_id_business_id_fkey" FOREIGN KEY ("id", "business_id") REFERENCES "catalog_items"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "service_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_images" ADD CONSTRAINT "service_images_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_images" ADD CONSTRAINT "service_images_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_images" ADD CONSTRAINT "service_images_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "catalog_items"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "catalog_items"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_listings" ADD CONSTRAINT "storefront_listings_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "catalog_items"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_order_items" ADD CONSTRAINT "storefront_order_items_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "catalog_items"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "products_legacy";
