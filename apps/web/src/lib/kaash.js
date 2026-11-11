const ROUTES = [
  ["/app", "dashboard.home"],
  ["/app/onboarding", "onboarding.workspace"],
  ["/app/subscription", "subscriptions.management"],
  ["/app/storefront", "storefront.management"],
  ["/app/sales", "sales.register"],
  ["/app/invoices", "invoices.list"],
  ["/app/parties", "parties.detail"],
  ["/app/customers", "customers.list"],
  ["/app/suppliers", "suppliers.list"],
  ["/app/products", "products.list"],
  ["/app/product-categories", "products.categories"],
  ["/app/services", "services.list"],
  ["/app/service-categories", "services.categories"],
  ["/app/inventory", "inventory.list"],
  ["/app/purchases", "purchases.list"],
  ["/app/expenses", "expenses.list"],
  ["/app/expense-categories", "expenses.categories"],
  ["/app/finance", "finance.overview"],
  ["/app/ledger", "ledger.entries"],
  ["/app/reports", "reports.overview"],
  ["/app/settings", "settings.workspace"],
];

export const KAASH_PLACEHOLDER = "بهمون بگو چه چیزی شاپرو رو بهترش میکنه\nکاش ...";

export function kaashScreenForPath(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app") return "dashboard.home";
  if (path === "/app/onboarding") return "onboarding.workspace";
  for (const [base, key] of ROUTES.slice(2)) {
    if (path === base) return key;
    if (!path.startsWith(`${base}/`)) continue;
    if (base === "/app/invoices") return "invoices.detail";
    if (base === "/app/parties") return "parties.detail";
    if (base === "/app/customers") return "customers.detail";
    if (base === "/app/suppliers") return "suppliers.detail";
    if (base === "/app/products") return "products.detail";
    if (base === "/app/services") return "services.detail";
    if (base === "/app/inventory") return "inventory.count-detail";
    if (base === "/app/purchases") return "purchases.detail";
    if (base === "/app/expenses") return "expenses.detail";
    if (base === "/app/finance") return "finance.detail";
    return key;
  }
  return "workspace.other";
}

export function normalizeKaashText(text) {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function kaashCharacterCount(text) {
  return Array.from(text.replace(/\r\n?/g, "\n")).length;
}

/** Keep every source character while dividing story text into pages that fit small screens. */
export function paginateKaashStory(text, widthPx, fontSizePx, maxLines = 20) {
  if (!text) return [""];
  const characters = Array.from(text);
  const charsPerLine = Math.max(18, Math.floor(widthPx / (fontSizePx * 1.35)));
  const pages = [];
  let start = 0;

  while (start < characters.length) {
    let end = start;
    let lines = 1;
    let lineLength = 0;
    let lastWhitespace = -1;
    while (end < characters.length) {
      const character = characters[end];
      if (character === "\n") {
        lines += 1;
        lineLength = 0;
      } else {
        lineLength += 1;
        if (lineLength > charsPerLine) {
          lines += 1;
          lineLength = 1;
        }
      }
      if (lines > maxLines) break;
      if (/\s/u.test(character)) lastWhitespace = end + 1;
      end += 1;
    }
    if (end === start) end += 1;
    const minimumNaturalBreak = start + Math.floor((end - start) * 0.72);
    if (end < characters.length && lastWhitespace >= minimumNaturalBreak) end = lastWhitespace;
    pages.push(characters.slice(start, end).join(""));
    start = end;
  }
  return pages;
}
