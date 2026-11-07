-- Scope catalog records to branches while retaining branch-correct historical references.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "catalog_items" AS item
    WHERE NOT EXISTS (SELECT 1 FROM "branches" AS branch WHERE branch."business_id" = item."business_id")
  ) OR EXISTS (
    SELECT 1
    FROM "product_categories" AS category
    WHERE NOT EXISTS (SELECT 1 FROM "branches" AS branch WHERE branch."business_id" = category."business_id")
  ) OR EXISTS (
    SELECT 1
    FROM "service_categories" AS category
    WHERE NOT EXISTS (SELECT 1 FROM "branches" AS branch WHERE branch."business_id" = category."business_id")
  ) THEN
    RAISE EXCEPTION 'Cannot scope the catalog: a catalog item or category belongs to a business without a branch.';
  END IF;
END $$;

ALTER TABLE "product_categories" ADD COLUMN "branch_id" UUID;
ALTER TABLE "service_categories" ADD COLUMN "branch_id" UUID;
ALTER TABLE "catalog_items" ADD COLUMN "branch_id" UUID;
ALTER TABLE "catalog_items" ADD COLUMN "origin_branch_id" UUID;
ALTER TABLE "catalog_items" ADD COLUMN "origin_item_id" UUID;
ALTER TABLE "products" ADD COLUMN "branch_id" UUID;
ALTER TABLE "services" ADD COLUMN "branch_id" UUID;
ALTER TABLE "sales_invoice_lines" ADD COLUMN "branch_id" UUID;
ALTER TABLE "purchase_lines" ADD COLUMN "branch_id" UUID;
ALTER TABLE "stock_count_lines" ADD COLUMN "branch_id" UUID;
ALTER TABLE "product_images" ADD COLUMN "storage_product_id" UUID;
ALTER TABLE "service_images" ADD COLUMN "storage_product_id" UUID;

-- A product identifier may repeat in different branches, so release the old business-wide SKU constraints first.
DROP INDEX "products_business_id_sku_key";
DROP INDEX "products_business_id_barcode_key";

CREATE TEMP TABLE "_catalog_branch_map" AS
SELECT item."id" AS "old_id", item."business_id", branch."id" AS "branch_id",
       CASE WHEN branch."id" = first_branch."id" THEN item."id" ELSE gen_random_uuid() END AS "new_id"
FROM "catalog_items" AS item
JOIN "branches" AS branch ON branch."business_id" = item."business_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "branches" AS candidate
  WHERE candidate."business_id" = item."business_id"
  ORDER BY candidate."created_at", candidate."id"
  LIMIT 1
) AS first_branch ON TRUE;
CREATE UNIQUE INDEX "_catalog_branch_map_old_branch_key" ON "_catalog_branch_map"("old_id", "branch_id");

CREATE TEMP TABLE "_product_category_branch_map" AS
SELECT category."id" AS "old_id", category."business_id", branch."id" AS "branch_id",
       CASE WHEN branch."id" = first_branch."id" THEN category."id" ELSE gen_random_uuid() END AS "new_id"
FROM "product_categories" AS category
JOIN "branches" AS branch ON branch."business_id" = category."business_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "branches" AS candidate
  WHERE candidate."business_id" = category."business_id"
  ORDER BY candidate."created_at", candidate."id"
  LIMIT 1
) AS first_branch ON TRUE;
CREATE UNIQUE INDEX "_product_category_branch_map_old_branch_key" ON "_product_category_branch_map"("old_id", "branch_id");

CREATE TEMP TABLE "_service_category_branch_map" AS
SELECT category."id" AS "old_id", category."business_id", branch."id" AS "branch_id",
       CASE WHEN branch."id" = first_branch."id" THEN category."id" ELSE gen_random_uuid() END AS "new_id"
FROM "service_categories" AS category
JOIN "branches" AS branch ON branch."business_id" = category."business_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "branches" AS candidate
  WHERE candidate."business_id" = category."business_id"
  ORDER BY candidate."created_at", candidate."id"
  LIMIT 1
) AS first_branch ON TRUE;
CREATE UNIQUE INDEX "_service_category_branch_map_old_branch_key" ON "_service_category_branch_map"("old_id", "branch_id");

-- Duplicate category trees for each branch, preserving IDs on the original branch.
UPDATE "product_categories" AS category
SET "branch_id" = mapping."branch_id"
FROM "_product_category_branch_map" AS mapping
WHERE category."id" = mapping."old_id" AND category."business_id" = mapping."business_id" AND mapping."new_id" = mapping."old_id";
INSERT INTO "product_categories" ("id", "business_id", "branch_id", "parent_id", "name", "is_active")
SELECT mapping."new_id", mapping."business_id", mapping."branch_id", category."parent_id", category."name", category."is_active"
FROM "_product_category_branch_map" AS mapping
JOIN "product_categories" AS category ON category."id" = mapping."old_id" AND category."business_id" = mapping."business_id"
WHERE mapping."new_id" <> mapping."old_id";
UPDATE "product_categories" AS child
SET "parent_id" = parent_mapping."new_id"
FROM "_product_category_branch_map" AS child_mapping, "_product_category_branch_map" AS parent_mapping
WHERE child."id" = child_mapping."new_id" AND child."business_id" = child_mapping."business_id" AND child."branch_id" = child_mapping."branch_id"
  AND child."parent_id" = parent_mapping."old_id" AND parent_mapping."business_id" = child_mapping."business_id" AND parent_mapping."branch_id" = child_mapping."branch_id";

UPDATE "service_categories" AS category
SET "branch_id" = mapping."branch_id"
FROM "_service_category_branch_map" AS mapping
WHERE category."id" = mapping."old_id" AND category."business_id" = mapping."business_id" AND mapping."new_id" = mapping."old_id";
INSERT INTO "service_categories" ("id", "business_id", "branch_id", "parent_id", "name", "is_active")
SELECT mapping."new_id", mapping."business_id", mapping."branch_id", category."parent_id", category."name", category."is_active"
FROM "_service_category_branch_map" AS mapping
JOIN "service_categories" AS category ON category."id" = mapping."old_id" AND category."business_id" = mapping."business_id"
WHERE mapping."new_id" <> mapping."old_id";
UPDATE "service_categories" AS child
SET "parent_id" = parent_mapping."new_id"
FROM "_service_category_branch_map" AS child_mapping, "_service_category_branch_map" AS parent_mapping
WHERE child."id" = child_mapping."new_id" AND child."business_id" = child_mapping."business_id" AND child."branch_id" = child_mapping."branch_id"
  AND child."parent_id" = parent_mapping."old_id" AND parent_mapping."business_id" = child_mapping."business_id" AND parent_mapping."branch_id" = child_mapping."branch_id";

-- Each branch starts with a copy of the existing catalog, then edits independently.
UPDATE "catalog_items" AS item
SET "branch_id" = mapping."branch_id"
FROM "_catalog_branch_map" AS mapping
WHERE item."id" = mapping."old_id" AND item."business_id" = mapping."business_id" AND mapping."new_id" = mapping."old_id";
INSERT INTO "catalog_items" (
  "id", "business_id", "branch_id", "name", "normalized_name", "kind", "unit_id", "sale_price_rial",
  "tax_rate_basis_points", "is_active", "archived_at", "created_at", "updated_at"
)
SELECT mapping."new_id", item."business_id", mapping."branch_id", item."name", item."normalized_name", item."kind", item."unit_id", item."sale_price_rial",
       item."tax_rate_basis_points", item."is_active", item."archived_at", item."created_at", item."updated_at"
FROM "_catalog_branch_map" AS mapping
JOIN "catalog_items" AS item ON item."id" = mapping."old_id" AND item."business_id" = mapping."business_id"
WHERE mapping."new_id" <> mapping."old_id";

CREATE TEMP TABLE "_product_branch_map" AS
SELECT mapping."old_id", mapping."business_id", mapping."branch_id", mapping."new_id"
FROM "_catalog_branch_map" AS mapping
JOIN "products" AS product ON product."id" = mapping."old_id" AND product."business_id" = mapping."business_id";
CREATE UNIQUE INDEX "_product_branch_map_old_branch_key" ON "_product_branch_map"("old_id", "branch_id");

CREATE TEMP TABLE "_service_branch_map" AS
SELECT mapping."old_id", mapping."business_id", mapping."branch_id", mapping."new_id"
FROM "_catalog_branch_map" AS mapping
JOIN "services" AS service ON service."id" = mapping."old_id" AND service."business_id" = mapping."business_id";
CREATE UNIQUE INDEX "_service_branch_map_old_branch_key" ON "_service_branch_map"("old_id", "branch_id");

UPDATE "products" AS product
SET "branch_id" = mapping."branch_id"
FROM "_product_branch_map" AS mapping
WHERE product."id" = mapping."old_id" AND product."business_id" = mapping."business_id" AND mapping."new_id" = mapping."old_id";
INSERT INTO "products" ("id", "business_id", "branch_id", "sku", "barcode", "category_id", "default_cost_rial", "reorder_point", "track_inventory")
SELECT mapping."new_id", product."business_id", mapping."branch_id", product."sku", product."barcode", category_mapping."new_id", product."default_cost_rial", product."reorder_point", product."track_inventory"
FROM "_product_branch_map" AS mapping
JOIN "products" AS product ON product."id" = mapping."old_id" AND product."business_id" = mapping."business_id"
LEFT JOIN "_product_category_branch_map" AS category_mapping
  ON category_mapping."old_id" = product."category_id" AND category_mapping."business_id" = product."business_id" AND category_mapping."branch_id" = mapping."branch_id"
WHERE mapping."new_id" <> mapping."old_id";

UPDATE "services" AS service
SET "branch_id" = mapping."branch_id"
FROM "_service_branch_map" AS mapping
WHERE service."id" = mapping."old_id" AND service."business_id" = mapping."business_id" AND mapping."new_id" = mapping."old_id";
INSERT INTO "services" ("id", "business_id", "branch_id", "category_id", "description")
SELECT mapping."new_id", service."business_id", mapping."branch_id", category_mapping."new_id", service."description"
FROM "_service_branch_map" AS mapping
JOIN "services" AS service ON service."id" = mapping."old_id" AND service."business_id" = mapping."business_id"
LEFT JOIN "_service_category_branch_map" AS category_mapping
  ON category_mapping."old_id" = service."category_id" AND category_mapping."business_id" = service."business_id" AND category_mapping."branch_id" = mapping."branch_id"
WHERE mapping."new_id" <> mapping."old_id";

-- Preserve the existing image-file path while the database record adopts its branch-specific catalog ID.
UPDATE "product_images" SET "storage_product_id" = "product_id";
UPDATE "service_images" SET "storage_product_id" = "service_id";
UPDATE "product_images" AS image
SET "product_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE image."product_id" = mapping."old_id" AND image."business_id" = mapping."business_id" AND image."branch_id" = mapping."branch_id";
UPDATE "service_images" AS image
SET "service_id" = mapping."new_id"
FROM "_service_branch_map" AS mapping
WHERE image."service_id" = mapping."old_id" AND image."business_id" = mapping."business_id" AND image."branch_id" = mapping."branch_id";

UPDATE "sales_invoice_lines" AS line SET "branch_id" = invoice."branch_id"
FROM "sales_invoices" AS invoice
WHERE invoice."id" = line."invoice_id" AND invoice."business_id" = line."business_id";
UPDATE "purchase_lines" AS line SET "branch_id" = purchase."branch_id"
FROM "purchases" AS purchase
WHERE purchase."id" = line."purchase_id" AND purchase."business_id" = line."business_id";
UPDATE "stock_count_lines" AS line SET "branch_id" = count."branch_id"
FROM "stock_counts" AS count
WHERE count."id" = line."stock_count_id" AND count."business_id" = line."business_id";

UPDATE "sales_invoice_lines" AS line SET "product_id" = mapping."new_id"
FROM "_catalog_branch_map" AS mapping
WHERE line."product_id" = mapping."old_id" AND line."business_id" = mapping."business_id" AND line."branch_id" = mapping."branch_id";
UPDATE "purchase_lines" AS line SET "product_id" = mapping."new_id"
FROM "_catalog_branch_map" AS mapping
WHERE line."product_id" = mapping."old_id" AND line."business_id" = mapping."business_id" AND line."branch_id" = mapping."branch_id";
UPDATE "storefront_listings" AS listing SET "product_id" = mapping."new_id"
FROM "_catalog_branch_map" AS mapping
WHERE listing."product_id" = mapping."old_id" AND listing."business_id" = mapping."business_id" AND listing."branch_id" = mapping."branch_id";
UPDATE "storefront_order_items" AS item SET "product_id" = mapping."new_id"
FROM "_catalog_branch_map" AS mapping
WHERE item."product_id" = mapping."old_id" AND item."business_id" = mapping."business_id" AND item."branch_id" = mapping."branch_id";

UPDATE "inventory_movements" AS movement SET "product_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE movement."product_id" = mapping."old_id" AND movement."business_id" = mapping."business_id" AND movement."branch_id" = mapping."branch_id";
UPDATE "inventory_movements" AS movement SET "source_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE movement."source_type" = 'PRODUCT_OPENING' AND movement."source_id" = mapping."old_id"
  AND movement."business_id" = mapping."business_id" AND movement."branch_id" = mapping."branch_id";
UPDATE "inventory_balances" AS balance SET "product_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE balance."product_id" = mapping."old_id" AND balance."business_id" = mapping."business_id" AND balance."branch_id" = mapping."branch_id";
UPDATE "stock_count_lines" AS line SET "product_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE line."product_id" = mapping."old_id" AND line."business_id" = mapping."business_id" AND line."branch_id" = mapping."branch_id";
UPDATE "storefront_reservations" AS reservation SET "product_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE reservation."product_id" = mapping."old_id" AND reservation."business_id" = mapping."business_id" AND reservation."branch_id" = mapping."branch_id";
UPDATE "journal_entries" AS entry SET "source_id" = mapping."new_id"
FROM "_product_branch_map" AS mapping
WHERE entry."source_type" = 'PRODUCT_OPENING' AND entry."source_id" = mapping."old_id"
  AND entry."business_id" = mapping."business_id" AND entry."branch_id" = mapping."branch_id";

ALTER TABLE "product_categories" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "service_categories" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "catalog_items" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "services" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "sales_invoice_lines" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "purchase_lines" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "stock_count_lines" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "product_images" ALTER COLUMN "storage_product_id" SET NOT NULL;
ALTER TABLE "service_images" ALTER COLUMN "storage_product_id" SET NOT NULL;

ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_transfer_origin_pair_check" CHECK (("origin_item_id" IS NULL) = ("origin_branch_id" IS NULL));

-- Replace business-wide foreign keys with branch-aware foreign keys.
ALTER TABLE "storefront_listings" DROP CONSTRAINT "storefront_listings_product_id_business_id_fkey";
ALTER TABLE "storefront_order_items" DROP CONSTRAINT "storefront_order_items_product_id_business_id_fkey";
ALTER TABLE "storefront_reservations" DROP CONSTRAINT "storefront_reservations_product_id_business_id_fkey";
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_parent_id_business_id_fkey";
ALTER TABLE "service_categories" DROP CONSTRAINT "service_categories_parent_id_business_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_id_business_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_business_id_fkey";
ALTER TABLE "services" DROP CONSTRAINT "services_id_business_id_fkey";
ALTER TABLE "services" DROP CONSTRAINT "services_category_id_business_id_fkey";
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_product_id_business_id_fkey";
ALTER TABLE "service_images" DROP CONSTRAINT "service_images_service_id_business_id_fkey";
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_invoice_id_business_id_fkey";
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_return_of_line_id_business_id_fkey";
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_product_id_business_id_fkey";
ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_purchase_id_business_id_fkey";
ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_product_id_business_id_fkey";
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_product_id_business_id_fkey";
ALTER TABLE "inventory_balances" DROP CONSTRAINT "inventory_balances_product_id_business_id_fkey";
ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_stock_count_id_business_id_fkey";
ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_product_id_business_id_fkey";

DROP INDEX "product_categories_business_id_is_active_idx";
DROP INDEX "service_categories_business_id_is_active_idx";
DROP INDEX "catalog_items_business_id_kind_is_active_normalized_name_idx";
DROP INDEX "products_business_id_category_id_idx";
DROP INDEX "services_business_id_category_id_idx";

CREATE INDEX "product_categories_business_id_branch_id_is_active_idx" ON "product_categories"("business_id", "branch_id", "is_active");
CREATE UNIQUE INDEX "product_categories_id_business_id_branch_id_key" ON "product_categories"("id", "business_id", "branch_id");
CREATE INDEX "service_categories_business_id_branch_id_is_active_idx" ON "service_categories"("business_id", "branch_id", "is_active");
CREATE UNIQUE INDEX "service_categories_id_business_id_branch_id_key" ON "service_categories"("id", "business_id", "branch_id");
CREATE INDEX "catalog_items_business_id_branch_id_kind_is_active_normaliz_idx" ON "catalog_items"("business_id", "branch_id", "kind", "is_active", "normalized_name");
CREATE UNIQUE INDEX "catalog_items_id_business_id_branch_id_key" ON "catalog_items"("id", "business_id", "branch_id");
CREATE UNIQUE INDEX "catalog_items_business_id_branch_id_origin_branch_id_origin_key" ON "catalog_items"("business_id", "branch_id", "origin_branch_id", "origin_item_id");
CREATE INDEX "products_business_id_branch_id_category_id_idx" ON "products"("business_id", "branch_id", "category_id");
CREATE UNIQUE INDEX "products_id_business_id_branch_id_key" ON "products"("id", "business_id", "branch_id");
CREATE UNIQUE INDEX "products_business_id_branch_id_sku_key" ON "products"("business_id", "branch_id", "sku");
CREATE UNIQUE INDEX "products_business_id_branch_id_barcode_key" ON "products"("business_id", "branch_id", "barcode");
CREATE INDEX "services_business_id_branch_id_category_id_idx" ON "services"("business_id", "branch_id", "category_id");
CREATE UNIQUE INDEX "services_id_business_id_branch_id_key" ON "services"("id", "business_id", "branch_id");
CREATE UNIQUE INDEX "sales_invoices_id_business_id_branch_id_key" ON "sales_invoices"("id", "business_id", "branch_id");
CREATE UNIQUE INDEX "sales_invoice_lines_id_business_id_branch_id_key" ON "sales_invoice_lines"("id", "business_id", "branch_id");
CREATE UNIQUE INDEX "purchases_id_business_id_branch_id_key" ON "purchases"("id", "business_id", "branch_id");
CREATE UNIQUE INDEX "stock_counts_id_business_id_branch_id_key" ON "stock_counts"("id", "business_id", "branch_id");

ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_business_id_branch_id_fkey" FOREIGN KEY ("parent_id", "business_id", "branch_id") REFERENCES "product_categories"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_parent_id_business_id_branch_id_fkey" FOREIGN KEY ("parent_id", "business_id", "branch_id") REFERENCES "service_categories"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_origin_item_id_business_id_origin_branch_id_fkey" FOREIGN KEY ("origin_item_id", "business_id", "origin_branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_id_business_id_branch_id_fkey" FOREIGN KEY ("id", "business_id", "branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_business_id_branch_id_fkey" FOREIGN KEY ("category_id", "business_id", "branch_id") REFERENCES "product_categories"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_branch_id_business_id_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_id_business_id_branch_id_fkey" FOREIGN KEY ("id", "business_id", "branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_business_id_branch_id_fkey" FOREIGN KEY ("category_id", "business_id", "branch_id") REFERENCES "service_categories"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "products"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_images" ADD CONSTRAINT "service_images_service_id_business_id_branch_id_fkey" FOREIGN KEY ("service_id", "business_id", "branch_id") REFERENCES "services"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_listings" ADD CONSTRAINT "storefront_listings_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_order_items" ADD CONSTRAINT "storefront_order_items_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storefront_reservations" ADD CONSTRAINT "storefront_reservations_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "products"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_business_id_branch_id_fkey" FOREIGN KEY ("invoice_id", "business_id", "branch_id") REFERENCES "sales_invoices"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_return_of_line_id_business_id_branch_i_fkey" FOREIGN KEY ("return_of_line_id", "business_id", "branch_id") REFERENCES "sales_invoice_lines"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_business_id_branch_id_fkey" FOREIGN KEY ("purchase_id", "business_id", "branch_id") REFERENCES "purchases"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "catalog_items"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "products"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "products"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_business_id_branch_id_fkey" FOREIGN KEY ("stock_count_id", "business_id", "branch_id") REFERENCES "stock_counts"("id", "business_id", "branch_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_business_id_branch_id_fkey" FOREIGN KEY ("product_id", "business_id", "branch_id") REFERENCES "products"("id", "business_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "_catalog_branch_map";
DROP TABLE "_product_category_branch_map";
DROP TABLE "_service_category_branch_map";
DROP TABLE "_product_branch_map";
DROP TABLE "_service_branch_map";

COMMIT;
