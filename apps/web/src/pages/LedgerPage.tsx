import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookOpen, Download } from "lucide-react";
import type { CursorPage } from "@shopro/contracts";
import { get } from "../lib/api.js";
import { downloadCsv } from "../lib/csv.js";
import { faNumber, jalaliDate, money } from "../lib/format.js";
import { EmptyState, InlineError, LoadMoreButton, LoadingBlock, PageHeader, SectionTitle, SelectField } from "../App.js";
import { JalaliDatePicker } from "../components/JalaliDatePicker.js";

type LedgerAccount = { id: string; code: string; name: string; type: string };
type LedgerLine = { id: string; date: string; entryNo: string; memo: string | null; sourceType: string; status: string; accountCode: string; account: string; accountType: string; party: string | null; description: string | null; debitRial: string; creditRial: string };
type LedgerResult = CursorPage<LedgerLine> & { totalDebitRial: string; totalCreditRial: string };
type LedgerFilters = { from: string; to: string; accountId: string };

export function LedgerPage({ currency }: { currency: "IRR" | "IRT" }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [filters, setFilters] = useState<LedgerFilters>({ from: "", to: "", accountId: "" });
  const [filterError, setFilterError] = useState("");
  const [exporting, setExporting] = useState(false);
  const accounts = useQuery({ queryKey: ["ledger-accounts"], queryFn: () => get<LedgerAccount[]>("/finance/ledger/accounts") });
  const businessId = sessionStorage.getItem("shopro_business_id");
  const branchId = sessionStorage.getItem("shopro_branch_id");
  const ledger = useInfiniteQuery({
    queryKey: ["ledger", businessId, branchId, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (pageParam) params.set("cursor", pageParam);
      return get<LedgerResult>(`/finance/ledger?${params.toString()}`);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = ledger.data?.pages.flatMap((page) => page.items) ?? [];
  const totals = ledger.data?.pages[0];
  const applyFilters = () => {
    if (from && to && from > to) { setFilterError("تاریخ شروع نباید پس از تاریخ پایان باشد."); return; }
    setFilterError(""); setFilters({ from, to, accountId });
  };
  const exportLedger = async () => {
    setExporting(true); setFilterError("");
    try {
      const allRows: LedgerLine[] = [];
      let cursor: string | undefined;
      let summary: LedgerResult | undefined;
      do {
        const params = new URLSearchParams({ limit: "100" });
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (filters.accountId) params.set("accountId", filters.accountId);
        if (cursor) params.set("cursor", cursor);
        summary = await get<LedgerResult>(`/finance/ledger?${params.toString()}`);
        allRows.push(...summary.items);
        cursor = summary.nextCursor ?? undefined;
        if (allRows.length >= 10_000 && cursor) throw new Error("دفتر بیش از ۱۰٬۰۰۰ ردیف دارد؛ خروجی کامل نیست.");
      } while (cursor);
      downloadCsv("shopro-ledger.csv", [["دفتر مالی کسب‌وکار"], ["از تاریخ", filters.from || "ابتدای سوابق"], ["تا تاریخ", filters.to || "پایان سوابق"], ["جمع بدهکار (ریال)", summary?.totalDebitRial ?? "0"], ["جمع بستانکار (ریال)", summary?.totalCreditRial ?? "0"], [], ["تاریخ", "شمارهٔ سند", "حساب", "شرح حساب", "طرف‌حساب", "شرح ردیف", "بدهکار (ریال)", "بستانکار (ریال)", "وضعیت"], ...allRows.map((row) => [row.date, row.entryNo, row.accountCode, row.account, row.party ?? "", row.description ?? row.memo ?? "", row.debitRial, row.creditRial, row.status === "REVERSED" ? "برگشت‌شده" : "ثبت‌شده"]) ]);
    } catch (cause) { setFilterError(cause instanceof Error ? cause.message : "دریافت دفتر مالی انجام نشد."); }
    finally { setExporting(false); }
  };
  return <PageHeader title="دفتر مالی" subtitle="ردیف‌های ثبت‌شده و برگشت‌شدهٔ این شعبه" actions={<button type="button" className="button button-secondary" disabled={!totals || exporting} onClick={() => void exportLedger()}><Download size={15} />{exporting ? "در حال آماده‌سازی…" : "دریافت CSV"}</button>}>
    <section className="card ledger-filters"><div className="form-grid"><JalaliDatePicker value={from} onChange={setFrom} label="از تاریخ" clearable /><JalaliDatePicker value={to} onChange={setTo} label="تا تاریخ" clearable /><SelectField label="حساب دفتر" value={accountId} onChange={setAccountId} options={(accounts.data ?? []).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))} placeholder="همهٔ حساب‌ها" /></div><button type="button" className="button button-primary" onClick={applyFilters}>اعمال فیلتر</button>{accounts.isError && <InlineError error={accounts.error} retry={() => void accounts.refetch()} />}{filterError && <p className="field-error" role="alert">{filterError}</p>}</section>
    {ledger.isPending ? <LoadingBlock /> : ledger.isError ? <InlineError error={ledger.error} retry={() => void ledger.refetch()} /> : <>
      <div className="metric-grid ledger-totals"><article className="metric-card"><span>جمع بدهکار</span><strong>{money(totals?.totalDebitRial ?? "0", currency)}</strong></article><article className="metric-card"><span>جمع بستانکار</span><strong>{money(totals?.totalCreditRial ?? "0", currency)}</strong></article><article className="metric-card"><span>ردیف‌های دیده‌شده</span><strong>{faNumber(rows.length)}{ledger.hasNextPage ? "+" : ""}</strong></article></div>
      <section className="card ledger-list"><SectionTitle title="گردش حساب‌ها" />{rows.length ? <div className="ledger-rows">{rows.map((row) => <article className="ledger-row" key={row.id}><div className="ledger-row-heading"><strong>{row.accountCode} · {row.account}</strong><span>{jalaliDate(row.date)}</span></div><div className="ledger-row-meta"><span>{row.entryNo}</span><span>{row.party ?? entryTypeLabel(row.sourceType)}</span><span>{row.status === "REVERSED" ? "برگشت‌شده" : "ثبت‌شده"}</span></div><p>{row.description ?? row.memo ?? "بدون شرح"}</p><div className="ledger-row-amounts"><span>بدهکار <strong>{money(row.debitRial, currency)}</strong></span><span>بستانکار <strong>{money(row.creditRial, currency)}</strong></span></div></article>)}</div> : <EmptyState icon={BookOpen} title="ردیفی پیدا نشد" text="در بازه یا حساب انتخاب‌شده سندی ثبت نشده است." />}<LoadMoreButton hasMore={Boolean(ledger.hasNextPage)} isLoading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()} /></section>
    </>}
  </PageHeader>;
}

function entryTypeLabel(value: string) { return ({ SALE: "فروش", SALE_RETURN: "برگشت فروش", PURCHASE: "خرید", PURCHASE_VOID: "ابطال خرید", EXPENSE: "هزینه", EXPENSE_VOID: "ابطال هزینه", CASH_TX: "دریافت یا پرداخت", CASH_TX_VOID: "ابطال تراکنش", STOCK_COUNT: "شمارش موجودی" } as Record<string, string>)[value] ?? "سند مالی"; }
