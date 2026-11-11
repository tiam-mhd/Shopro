import test from "node:test";
import assert from "node:assert/strict";
import { KAASH_PLACEHOLDER, kaashCharacterCount, kaashScreenForPath, normalizeKaashText, paginateKaashStory } from "../src/lib/kaash.js";

test("launcher maps every operational route family to an allowlisted screen key without retaining record ids", () => {
  const routes = [
    ["/app", "dashboard.home"], ["/app/onboarding", "onboarding.workspace"], ["/app/subscription", "subscriptions.management"],
    ["/app/storefront", "storefront.management"], ["/app/sales", "sales.register"], ["/app/invoices", "invoices.list"],
    ["/app/invoices/93d1a", "invoices.detail"], ["/app/customers", "customers.list"], ["/app/customers/person-id", "customers.detail"],
    ["/app/suppliers", "suppliers.list"], ["/app/suppliers/person-id", "suppliers.detail"], ["/app/products", "products.list"],
    ["/app/products/item-id", "products.detail"], ["/app/product-categories", "products.categories"], ["/app/services", "services.list"],
    ["/app/services/item-id", "services.detail"], ["/app/service-categories", "services.categories"], ["/app/inventory", "inventory.list"],
    ["/app/inventory/counts/count-id", "inventory.count-detail"], ["/app/purchases", "purchases.list"], ["/app/purchases/id", "purchases.detail"],
    ["/app/expenses", "expenses.list"], ["/app/expenses/id", "expenses.detail"], ["/app/expense-categories", "expenses.categories"],
    ["/app/finance", "finance.overview"], ["/app/finance/account/id", "finance.detail"], ["/app/ledger", "ledger.entries"],
    ["/app/reports", "reports.overview"], ["/app/settings", "settings.workspace"],
  ];
  for (const [path, expected] of routes) assert.equal(kaashScreenForPath(path), expected, path);
  assert.equal(kaashScreenForPath("/system-admin/kaash"), "workspace.other");
  assert.equal(kaashScreenForPath("/app/invoices/private-id"), "invoices.detail");
});

test("placeholder is exactly two lines and is not seeded into the textarea value", () => {
  assert.equal(KAASH_PLACEHOLDER, "بهمون بگو چه چیزی شاپرو رو بهترش میکنه\nکاش ...");
  assert.equal(KAASH_PLACEHOLDER.split("\n").length, 2);
});

test("text normalization rejects whitespace and counts astral emoji as one character", () => {
  assert.equal(normalizeKaashText("  \r\n  "), "");
  assert.equal(normalizeKaashText("  سلام\r\nکاش  "), "سلام\nکاش");
  assert.equal(kaashCharacterCount("🙂🙂\r\nک"), 4);
});

test("story pagination preserves every character and bounds explicit newlines", () => {
  const source = `${"هر خط یک پیشنهاد است\n".repeat(45)}${"ایدهٔ فروشگاه آنلاین بهتر " .repeat(45)}🙂 پایان`;
  const pages = paginateKaashStory(source, 320, 18, 12);
  assert.ok(pages.length > 1);
  assert.equal(pages.join(""), source);
  assert.ok(pages.every((part) => part.length > 0));
  assert.ok(pages.every((part) => part.split("\n").length <= 12));
});
