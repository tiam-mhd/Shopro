import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookOpen, Download, Filter, RotateCcw } from "lucide-react";
import type { CursorPage } from "@shopro/contracts";
import { get } from "../lib/api.js";
import { downloadCsv } from "../lib/csv.js";
import { faNumber, jalaliDate, money } from "../lib/format.js";
import { EmptyState, InlineError, LoadMoreButton, LoadingBlock, PageHeader, SelectField } from "../App.js";
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
  const activeFilterLabels = [
    filters.from ? `از ${jalaliDate(filters.from)}` : "",
    filters.to ? `تا ${jalaliDate(filters.to)}` : "",
    filters.accountId ? accounts.data?.find((account) => account.id === filters.accountId)?.name ?? "حساب انتخاب‌شده" : "",
  ].filter(Boolean);
  const applyFilters = () => {
    if (from && to && from > to) { setFilterError("تاریخ شروع نباید پس از تاریخ پایان باشد."); return; }
    setFilterError(""); setFilters({ from, to, accountId });
  };
  const clearFilters = () => { setFrom(""); setTo(""); setAccountId(""); setFilters({ from: "", to: "", accountId: "" }); setFilterError(""); };
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
  return <PageHeader title="دفتر مالی" subtitle="گردش حساب‌های ثبت‌شده در شعبهٔ جاری" actions={<button type="button" className="button button-secondary" disabled={!totals || exporting} onClick={() => void exportLedger()}><Download size={15} />{exporting ? "در حال آماده‌سازی…" : "خروجی CSV"}</button>}>
    <div className="ledger-page">
      <section className="card ledger-filter-panel" aria-label="فیلتر دفتر مالی">
        <div className="ledger-filter-top"><div><span className="eyebrow">جست‌وجوی دفتر</span><strong>فیلتر گردش حساب</strong></div><span className="ledger-filter-scope">{activeFilterLabels.length ? `${faNumber(activeFilterLabels.length)} فیلتر فعال` : "تمام سوابق این شعبه"}</span></div>
        <div className="ledger-filter-fields"><JalaliDatePicker value={from} onChange={setFrom} label="از تاریخ" clearable /><JalaliDatePicker value={to} onChange={setTo} label="تا تاریخ" clearable /><SelectField label="حساب دفتر" value={accountId} onChange={setAccountId} options={(accounts.data ?? []).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))} placeholder="همهٔ حساب‌ها" /><div className="ledger-filter-actions"><button type="button" className="button button-primary" onClick={applyFilters}><Filter size={15} />اعمال</button>{activeFilterLabels.length > 0 && <button type="button" className="button button-text" onClick={clearFilters}><RotateCcw size={14} />پاک‌کردن</button>}</div></div>
        {activeFilterLabels.length > 0 && <div className="ledger-filter-chips" aria-label="فیلترهای اعمال‌شده">{activeFilterLabels.map((label) => <span key={label}>{label}</span>)}</div>}
        {accounts.isError && <InlineError error={accounts.error} retry={() => void accounts.refetch()} />}{filterError && <p className="field-error" role="alert">{filterError}</p>}
      </section>
      {ledger.isPending ? <LoadingBlock /> : ledger.isError ? <InlineError error={ledger.error} retry={() => void ledger.refetch()} /> : <>
        <section className="ledger-summary-strip" aria-label="خلاصهٔ دفتر مالی">
          <article className="ledger-summary-card is-debit"><span>جمع بدهکار</span><strong>{money(totals?.totalDebitRial ?? "0", currency)}</strong><small>بر اساس فیلترهای اعمال‌شده</small></article>
          <article className="ledger-summary-card is-credit"><span>جمع بستانکار</span><strong>{money(totals?.totalCreditRial ?? "0", currency)}</strong><small>بر اساس فیلترهای اعمال‌شده</small></article>
          <article className="ledger-summary-card is-count"><span>ردیف‌های بارگذاری‌شده</span><strong>{faNumber(rows.length)}{ledger.hasNextPage ? "+" : ""}</strong><small>{ledger.hasNextPage ? "موارد قدیمی‌تر در دسترس است" : "تمام ردیف‌های این فیلتر"}</small></article>
        </section>
        <section className="card ledger-register">
          <header className="ledger-register-head"><div><span className="eyebrow">دفتر کل</span><h2>گردش حساب‌ها</h2><p>اسناد جدیدتر در ابتدای فهرست نمایش داده می‌شوند.</p></div><span className="ledger-register-count"><BookOpen size={15} />{faNumber(rows.length)} ردیف</span></header>
          {rows.length ? <>
            <div className="ledger-table-head" aria-hidden="true"><span>تاریخ و حساب</span><span>شمارهٔ سند و طرف‌حساب</span><span>بدهکار</span><span>بستانکار</span></div>
            <div className="ledger-rows">{rows.map((row) => <article className="ledger-entry" key={row.id}>
              <div className="ledger-entry-primary"><time dateTime={row.date}>{jalaliDate(row.date)}</time><div><strong>{row.accountCode} · {row.account}</strong><small>{row.description ?? row.memo ?? entryTypeLabel(row.sourceType)}</small></div></div>
              <div className="ledger-entry-reference"><strong dir="ltr">{row.entryNo}</strong><span>{row.party ?? entryTypeLabel(row.sourceType)}</span><small className={row.status === "REVERSED" ? "is-reversed" : ""}>{row.status === "REVERSED" ? "برگشت‌شده" : "ثبت‌شده"}</small></div>
              <div className="ledger-entry-amount is-debit"><span>بدهکار</span><strong>{row.debitRial === "0" ? "—" : money(row.debitRial, currency)}</strong></div>
              <div className="ledger-entry-amount is-credit"><span>بستانکار</span><strong>{row.creditRial === "0" ? "—" : money(row.creditRial, currency)}</strong></div>
            </article>)}</div>
            <LoadMoreButton hasMore={Boolean(ledger.hasNextPage)} isLoading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()} />
          </> : <EmptyState icon={BookOpen} title="ردیفی برای نمایش نیست" text={activeFilterLabels.length ? "با فیلترهای فعلی سندی پیدا نشد؛ فیلترها را پاک کنید یا بازهٔ دیگری را انتخاب کنید." : "با ثبت فروش، خرید، هزینه یا دریافت و پرداخت، گردش دفتر در اینجا نمایش داده می‌شود."} action={activeFilterLabels.length ? <button type="button" className="button button-secondary" onClick={clearFilters}>نمایش همهٔ سوابق</button> : undefined} />}
        </section>
      </>}
    </div>
  </PageHeader>;
}

function entryTypeLabel(value: string) { return ({ SALE: "فروش", SALE_RETURN: "برگشت فروش", PURCHASE: "خرید", PURCHASE_VOID: "ابطال خرید", EXPENSE: "هزینه", EXPENSE_VOID: "ابطال هزینه", CASH_TX: "دریافت یا پرداخت", CASH_TX_VOID: "ابطال تراکنش", STOCK_COUNT: "شمارش موجودی" } as Record<string, string>)[value] ?? "سند مالی"; }
