ALTER TABLE "units"
  ADD COLUMN "group_key" VARCHAR(24) NOT NULL DEFAULT 'count',
  ADD COLUMN "is_visible" BOOLEAN NOT NULL DEFAULT false;

UPDATE "units" SET "is_visible" = true;

UPDATE "units" AS old_unit
SET "code" = 'pcs'
WHERE old_unit."code" = 'unit'
  AND NOT EXISTS (
    SELECT 1
    FROM "units" AS canonical
    WHERE canonical."business_id" = old_unit."business_id"
      AND canonical."code" = 'pcs'
  );

UPDATE "units"
SET "label_fa" = 'عدد', "precision" = 0, "group_key" = 'count', "is_visible" = ("code" = 'pcs')
WHERE "code" IN ('pcs', 'unit');

INSERT INTO "units" ("id", "business_id", "code", "label_fa", "precision", "group_key", "is_visible")
SELECT gen_random_uuid(), business."id", catalog."code", catalog."label_fa", catalog."precision", catalog."group_key", catalog."is_visible"
FROM "businesses" AS business
CROSS JOIN (VALUES
  ('pcs', 'عدد', 0, 'count', true),
  ('pair', 'جفت', 0, 'count', false),
  ('set', 'ست', 0, 'count', false),
  ('pack', 'بسته', 0, 'count', false),
  ('box', 'جعبه', 0, 'count', false),
  ('carton', 'کارتن', 0, 'count', false),
  ('bag', 'کیسه', 0, 'count', false),
  ('bottle', 'بطری', 0, 'count', false),
  ('sheet', 'ورق', 0, 'count', false),
  ('rod', 'شاخه', 0, 'count', false),
  ('roll', 'رول', 0, 'count', false),
  ('bundle', 'بندیل', 0, 'count', false),
  ('dozen', 'دوجین', 0, 'count', false),
  ('person', 'نفر', 0, 'count', false),
  ('mg', 'میلی‌گرم', 3, 'weight', false),
  ('g', 'گرم', 3, 'weight', false),
  ('kg', 'کیلوگرم', 3, 'weight', false),
  ('ton', 'تن', 3, 'weight', false),
  ('mm', 'میلی‌متر', 3, 'length', false),
  ('cm', 'سانتی‌متر', 3, 'length', false),
  ('inch', 'اینچ', 3, 'length', false),
  ('m', 'متر', 3, 'length', false),
  ('km', 'کیلومتر', 3, 'length', false),
  ('cm2', 'سانتی‌متر مربع', 3, 'area', false),
  ('m2', 'متر مربع', 3, 'area', false),
  ('ha', 'هکتار', 3, 'area', false),
  ('ml', 'میلی‌لیتر', 3, 'volume', false),
  ('l', 'لیتر', 3, 'volume', false),
  ('gallon', 'گالن', 3, 'volume', false),
  ('m3', 'متر مکعب', 3, 'volume', false),
  ('minute', 'دقیقه', 3, 'time', false),
  ('hour', 'ساعت', 3, 'time', false),
  ('day', 'روز', 0, 'time', false),
  ('month', 'ماه', 0, 'time', false),
  ('service', 'خدمت', 0, 'service', false),
  ('session', 'جلسه', 0, 'service', false),
  ('visit', 'نوبت', 0, 'service', false)
) AS catalog("code", "label_fa", "precision", "group_key", "is_visible")
ON CONFLICT ("business_id", "code") DO UPDATE
SET "label_fa" = EXCLUDED."label_fa",
    "precision" = EXCLUDED."precision",
    "group_key" = EXCLUDED."group_key";
