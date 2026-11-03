BEGIN;

-- Preserve all previously consumed branch counters before collapsing them.
CREATE TEMP TABLE "_document_sequence_rollup" ON COMMIT DROP AS
WITH legacy_values AS (
  SELECT "business_id", "type", "next_value" AS "next_value"
  FROM "document_sequences"
  UNION ALL
  SELECT "business_id", 'JOURNAL', MAX(substring("entry_no" FROM '^D-([0-9]+)$')::BIGINT) + 1
  FROM "journal_entries"
  WHERE "entry_no" ~ '^D-[0-9]+$'
  GROUP BY "business_id"
  UNION ALL
  SELECT "business_id", 'SALE', MAX(substring("invoice_no" FROM '^S-([0-9]+)$')::BIGINT) + 1
  FROM "sales_invoices"
  WHERE "invoice_no" ~ '^S-[0-9]+$'
  GROUP BY "business_id"
  UNION ALL
  SELECT "business_id", 'RETURN', MAX(substring("invoice_no" FROM '^R-([0-9]+)$')::BIGINT) + 1
  FROM "sales_invoices"
  WHERE "invoice_no" ~ '^R-[0-9]+$'
  GROUP BY "business_id"
  UNION ALL
  SELECT "business_id", 'PURCHASE', MAX(substring("purchase_no" FROM '^P-([0-9]+)$')::BIGINT) + 1
  FROM "purchases"
  WHERE "purchase_no" ~ '^P-[0-9]+$'
  GROUP BY "business_id"
  UNION ALL
  SELECT "business_id", 'EXPENSE', MAX(substring("expense_no" FROM '^E-([0-9]+)$')::BIGINT) + 1
  FROM "expenses"
  WHERE "expense_no" ~ '^E-[0-9]+$'
  GROUP BY "business_id"
)
SELECT "business_id", "type", GREATEST(MAX("next_value"), 1) AS "next_value"
FROM legacy_values
GROUP BY "business_id", "type";

-- Give already-posted expenses stable document numbers; drafts remain unnumbered.
WITH maxima AS (
  SELECT "business_id", MAX(substring("expense_no" FROM '^E-([0-9]+)$')::BIGINT) AS "max_number"
  FROM "expenses"
  WHERE "expense_no" ~ '^E-[0-9]+$'
  GROUP BY "business_id"
), missing AS (
  SELECT expense."id",
         COALESCE(maxima."max_number", 0) + row_number() OVER (PARTITION BY expense."business_id" ORDER BY expense."created_at", expense."id") AS "number"
  FROM "expenses" AS expense
  LEFT JOIN maxima ON maxima."business_id" = expense."business_id"
  WHERE expense."status" = 'POSTED' AND expense."expense_no" IS NULL
)
UPDATE "expenses" AS expense
SET "expense_no" = 'E-' || lpad(missing."number"::TEXT, 6, '0')
FROM missing
WHERE expense."id" = missing."id";

-- Include newly assigned expense numbers in the next counter value.
INSERT INTO "_document_sequence_rollup" ("business_id", "type", "next_value")
SELECT "business_id", 'EXPENSE', MAX(substring("expense_no" FROM '^E-([0-9]+)$')::BIGINT) + 1
FROM "expenses"
WHERE "expense_no" ~ '^E-[0-9]+$'
GROUP BY "business_id";

CREATE TEMP TABLE "_document_sequence_final" ON COMMIT DROP AS
SELECT "business_id", "type", GREATEST(MAX("next_value"), 1) AS "next_value"
FROM "_document_sequence_rollup"
GROUP BY "business_id", "type";

ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_branch_id_business_id_fkey";
DROP INDEX "document_sequences_business_id_branch_id_type_key";
ALTER TABLE "document_sequences" DROP COLUMN "branch_id";
DELETE FROM "document_sequences";
INSERT INTO "document_sequences" ("id", "business_id", "type", "next_value")
SELECT gen_random_uuid(), "business_id", "type", "next_value"
FROM "_document_sequence_final";
CREATE UNIQUE INDEX "document_sequences_business_id_type_key" ON "document_sequences"("business_id", "type");

COMMIT;
