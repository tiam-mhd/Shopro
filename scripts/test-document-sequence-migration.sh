#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to an isolated test PostgreSQL database}"
repo_root="$(git rev-parse --show-toplevel)"
db_name="shopro_upgrade_$(node -e 'process.stdout.write(require("node:crypto").randomBytes(5).toString("hex"))')"
admin_url="$(DATABASE_URL="$DATABASE_URL" DB_NAME="$db_name" node -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = "/postgres"; url.searchParams.delete("schema"); process.stdout.write(url.toString())')"
test_url="$(DATABASE_URL="$DATABASE_URL" DB_NAME="$db_name" node -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = "/" + process.env.DB_NAME; url.searchParams.delete("schema"); process.stdout.write(url.toString())')"

psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db_name\"" >/dev/null
cleanup() { psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE)" >/dev/null; }
trap cleanup EXIT

psql "$test_url" -v ON_ERROR_STOP=1 -f "$repo_root/prisma/migrations/20261101000000_init/migration.sql" >/dev/null
psql "$test_url" -v ON_ERROR_STOP=1 -f "$repo_root/prisma/migrations/20261101020000_unit_catalog_visibility/migration.sql" >/dev/null
psql "$test_url" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "businesses" ("id", "display_name", "business_type", "updated_at") VALUES
  ('10000000-0000-4000-8000-000000000001', 'Test', 'Test', now());
INSERT INTO "branches" ("id", "business_id", "name", "code") VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Branch A', 'A'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Branch B', 'B');
INSERT INTO "document_sequences" ("id", "business_id", "branch_id", "type", "next_value") VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'JOURNAL', 3),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'JOURNAL', 9),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'SALE', 2),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'SALE', 2);
INSERT INTO "sales_invoices" ("id", "business_id", "branch_id", "invoice_no", "txn_date", "status", "updated_at") VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'S-000010', DATE '2026-11-01', 'POSTED', now());
INSERT INTO "users" ("id", "phone", "updated_at") VALUES
  ('50000000-0000-4000-8000-000000000001', '09120000000', now());
INSERT INTO "ledger_accounts" ("id", "business_id", "code", "name", "type") VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '6000', 'Expense', 'EXPENSE');
INSERT INTO "expense_categories" ("id", "business_id", "name", "expense_ledger_account_id") VALUES
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'General', '60000000-0000-4000-8000-000000000001');
INSERT INTO "expenses" ("id", "business_id", "branch_id", "category_id", "expense_no", "txn_date", "amount_rial", "status", "created_by") VALUES
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'E-000009', DATE '2026-11-01', 100, 'POSTED', '50000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', NULL, DATE '2026-11-02', 200, 'POSTED', '50000000-0000-4000-8000-000000000001');
SQL

psql "$test_url" -v ON_ERROR_STOP=1 -f "$repo_root/prisma/migrations/20261103010000_business_wide_document_sequences/migration.sql" >/dev/null
psql "$test_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE journal_next BIGINT; sale_next BIGINT; expense_next BIGINT; backfilled TEXT;
BEGIN
  SELECT "next_value" INTO journal_next FROM "document_sequences" WHERE "business_id" = '10000000-0000-4000-8000-000000000001' AND "type" = 'JOURNAL';
  SELECT "next_value" INTO sale_next FROM "document_sequences" WHERE "business_id" = '10000000-0000-4000-8000-000000000001' AND "type" = 'SALE';
  SELECT "next_value" INTO expense_next FROM "document_sequences" WHERE "business_id" = '10000000-0000-4000-8000-000000000001' AND "type" = 'EXPENSE';
  SELECT "expense_no" INTO backfilled FROM "expenses" WHERE "id" = '80000000-0000-4000-8000-000000000002';
  IF journal_next <> 9 OR sale_next <> 11 OR expense_next <> 11 OR backfilled <> 'E-000010' THEN
    RAISE EXCEPTION 'sequence migration failed: journal %, sale %, expense %, backfill %', journal_next, sale_next, expense_next, backfilled;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_sequences' AND column_name = 'branch_id') THEN
    RAISE EXCEPTION 'legacy branch_id column remains';
  END IF;
END $$;
SQL

printf 'Document sequence upgrade migration passed.\n'
