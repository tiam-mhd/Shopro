import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { assertUuid } from "../common/uuid-param.pipe.js";

type PartyBalanceCursor = { normalizedName: string; id: string };
type PartyBalanceRow = { id: string; name: string; phone: string | null; normalizedName: string; balanceRial: string };

function encodePartyBalanceCursor(cursor: PartyBalanceCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePartyBalanceCursor(value: string | undefined) {
  if (value === undefined) return undefined;
  const invalid = () => { throw new BadRequestException("نشانگر صفحه برای ماندهٔ طرف‌حساب معتبر نیست؛ گزارش را دوباره بارگذاری کنید."); };
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  let parsed: unknown;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) invalid();
    parsed = JSON.parse(decoded);
  } catch { invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
  const candidate = parsed as Record<string, unknown>;
  const normalizedName = candidate.normalizedName;
  const id = candidate.id;
  if (typeof normalizedName !== "string" || normalizedName.length < 1 || normalizedName.length > 200 || typeof id !== "string") return invalid();
  assertUuid(id as string, "نشانگر صفحه برای ماندهٔ طرف‌حساب معتبر نیست.");
  return { normalizedName: normalizedName as string, id: id as string };
}

export function buildPartyBalanceQuery(input: { businessId: string; branchId: string; type: "receivable" | "payable"; cursor?: PartyBalanceCursor; limit: number }) {
  const key = input.type === "receivable" ? "accounts_receivable" : "accounts_payable";
  const afterName = input.cursor?.normalizedName ?? null;
  const afterId = input.cursor?.id ?? "00000000-0000-0000-0000-000000000000";
  const receivable = input.type === "receivable";
  return Prisma.sql`
    SELECT p.id, p.name, p.phone, p.normalized_name AS "normalizedName",
      (CASE WHEN ${receivable}
        THEN SUM(jl.debit_rial) - SUM(jl.credit_rial)
        ELSE SUM(jl.credit_rial) - SUM(jl.debit_rial)
      END)::text AS "balanceRial"
    FROM parties p
    JOIN journal_lines jl
      ON jl.party_id = p.id AND jl.business_id = p.business_id
    JOIN ledger_accounts la
      ON la.id = jl.ledger_account_id AND la.business_id = jl.business_id
    JOIN journal_entries je
      ON je.id = jl.journal_entry_id AND je.business_id = jl.business_id
    WHERE p.business_id = ${input.businessId}::uuid
      AND p.archived_at IS NULL
      AND jl.business_id = ${input.businessId}::uuid
      AND jl.branch_id = ${input.branchId}::uuid
      AND je.branch_id = ${input.branchId}::uuid
      AND la.system_key = ${key}
      AND je.status::text IN ('POSTED', 'REVERSED')
      AND (${afterName}::text IS NULL OR (p.normalized_name, p.id) > (${afterName}::text, ${afterId}::uuid))
    GROUP BY p.id, p.name, p.phone, p.normalized_name
    HAVING CASE WHEN ${receivable}
      THEN SUM(jl.debit_rial) - SUM(jl.credit_rial)
      ELSE SUM(jl.credit_rial) - SUM(jl.debit_rial)
    END > 0
    ORDER BY p.normalized_name ASC, p.id ASC
    LIMIT ${input.limit}
  `;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(user: AuthenticatedUser, from?: string, to?: string) {
    const { businessId, branchId } = this.scope(user);
    this.requireReportRole(user);
    const range = await this.range(from, to, businessId);
    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { displayCurrency: true, inventoryEnabled: true } });
    const [sales, expenses, receipts, accounts, lowStock, invoices, lines, todaySales, salesCount] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: { businessId, branchId, status: "POSTED", txnDate: range }, _sum: { totalRial: true, subtotalRial: true, discountRial: true, taxRial: true }, _count: { id: true } }),
      this.prisma.expense.aggregate({ where: { businessId, branchId, status: "POSTED", txnDate: range }, _sum: { amountRial: true, taxRial: true }, _count: { id: true } }),
      this.prisma.cashTransaction.aggregate({ where: { businessId, branchId, kind: "RECEIPT", status: "POSTED", txnDate: range, journalEntry: { status: "POSTED" } }, _sum: { amountRial: true } }),
      this.prisma.financeAccount.findMany({ where: { businessId, branchId, isActive: true }, select: { id: true, name: true, ledgerAccountId: true, kind: true } }),
      this.prisma.product.findMany({ where: { businessId, isActive: true, trackInventory: true, reorderPoint: { not: null } }, include: { unit: { select: { labelFa: true } }, balances: { where: { branchId }, select: { quantityOnHand: true } } }, take: 500 }),
      this.prisma.salesInvoice.findMany({ where: { businessId, branchId, status: "POSTED", txnDate: range }, select: { id: true, txnDate: true, totalRial: true, allocations: { select: { amountRial: true } } } }),
      this.prisma.salesInvoiceLine.findMany({ where: { businessId, invoice: { businessId, branchId, status: "POSTED", txnDate: range } }, select: { cogsRial: true, product: { select: { kind: true, trackInventory: true } }, lineTotalRial: true, discountRial: true, taxRial: true } }),
      this.prisma.salesInvoice.groupBy({ by: ["txnDate"], where: { businessId, branchId, status: "POSTED", txnDate: range }, _sum: { totalRial: true }, orderBy: { txnDate: "asc" } }),
      this.prisma.salesInvoice.count({ where: { businessId, branchId, status: "POSTED", returnOfId: null, txnDate: range } }),
    ]);
    const accountSums = await this.prisma.journalLine.groupBy({ by: ["ledgerAccountId"], where: { businessId, branchId, ledgerAccountId: { in: accounts.map((account) => account.ledgerAccountId) }, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitRial: true, creditRial: true } });
    const cashByLedger = new Map(accountSums.map((item) => [item.ledgerAccountId, (item._sum.debitRial ?? 0n) - (item._sum.creditRial ?? 0n)]));
    const cogsUnknown = business.inventoryEnabled && lines.some((line) => line.product?.kind === "STOCK" && line.product.trackInventory && line.cogsRial === null);
    const cogs = lines.reduce((sum, line) => sum + (line.cogsRial ?? 0n), 0n);
    const netSales = (sales._sum.subtotalRial ?? 0n) - (sales._sum.discountRial ?? 0n);
    const lowItems = lowStock.filter((product) => Number(product.balances[0]?.quantityOnHand ?? 0) <= Number(product.reorderPoint ?? 0)).map((product) => ({ id: product.id, name: product.name, quantity: product.balances[0]?.quantityOnHand.toString() ?? "0", reorderPoint: product.reorderPoint?.toString() ?? "0", unit: product.unit.labelFa }));
    return {
      range: { from: from ?? this.iso(range.gte), to: to ?? this.iso(range.lte) },
      displayCurrency: business.displayCurrency,
      salesRial: (sales._sum.totalRial ?? 0n).toString(),
      netSalesRial: netSales.toString(),
      receiptsRial: (receipts._sum.amountRial ?? 0n).toString(),
      expensesRial: ((expenses._sum.amountRial ?? 0n) + (expenses._sum.taxRial ?? 0n)).toString(),
      grossProfitRial: cogsUnknown ? null : (netSales - cogs).toString(),
      grossProfitAvailable: !cogsUnknown,
      salesCount,
      expenseCount: expenses._count.id,
      accountBalances: accounts.map((account) => ({ id: account.id, name: account.name, kind: account.kind, balanceRial: (cashByLedger.get(account.ledgerAccountId) ?? 0n).toString() })),
      cashPositionRial: accounts.reduce((sum, account) => sum + (cashByLedger.get(account.ledgerAccountId) ?? 0n), 0n).toString(),
      lowStock: lowItems,
      openInvoices: invoices.filter((invoice) => invoice.totalRial > invoice.allocations.reduce((sum, allocation) => sum + allocation.amountRial, 0n)).length,
      salesTrend: todaySales.map((point) => ({ date: point.txnDate.toISOString().slice(0, 10), totalRial: (point._sum.totalRial ?? 0n).toString() })),
    };
  }

  async profitLoss(user: AuthenticatedUser, from?: string, to?: string) {
    const { businessId, branchId } = this.scope(user); this.requireReportRole(user);
    const date = await this.range(from, to, businessId);
    const grouped = await this.prisma.journalLine.groupBy({
      by: ["ledgerAccountId"],
      where: { businessId, branchId, ledgerAccount: { type: { in: ["REVENUE", "EXPENSE"] } }, journalEntry: { status: { in: ["POSTED", "REVERSED"] }, txnDate: date } },
      _sum: { debitRial: true, creditRial: true },
    });
    const accounts = grouped.length ? await this.prisma.ledgerAccount.findMany({ where: { businessId, id: { in: grouped.map((row) => row.ledgerAccountId) } }, select: { id: true, name: true, type: true } }) : [];
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const entries = grouped.flatMap((row) => {
      const account = accountById.get(row.ledgerAccountId);
      if (!account || !["REVENUE", "EXPENSE"].includes(account.type)) return [];
      const debit = row._sum.debitRial ?? 0n; const credit = row._sum.creditRial ?? 0n;
      return [{ id: account.id, name: account.name, type: account.type, amountRial: (account.type === "REVENUE" ? credit - debit : debit - credit).toString() }];
    });
    const income = entries.filter((row) => row.type === "REVENUE").reduce((sum, row) => sum + BigInt(row.amountRial), 0n);
    const expenses = entries.filter((row) => row.type === "EXPENSE").reduce((sum, row) => sum + BigInt(row.amountRial), 0n);
    return { range: { from: from ?? this.iso(date.gte), to: to ?? this.iso(date.lte) }, revenueRial: income.toString(), expenseRial: expenses.toString(), netProfitRial: (income - expenses).toString(), accounts: entries };
  }

  async cashFlow(user: AuthenticatedUser, from?: string, to?: string) {
    const { businessId, branchId } = this.scope(user); this.requireReportRole(user);
    const date = await this.range(from, to, businessId);
    const rows = await this.prisma.cashTransaction.groupBy({ by: ["kind"], where: { businessId, branchId, status: "POSTED", txnDate: date, kind: { in: ["RECEIPT", "PAYMENT"] } }, _sum: { amountRial: true } });
    const received = rows.find((row) => row.kind === "RECEIPT")?._sum.amountRial ?? 0n;
    const paid = rows.find((row) => row.kind === "PAYMENT")?._sum.amountRial ?? 0n;
    return { range: { from: from ?? this.iso(date.gte), to: to ?? this.iso(date.lte) }, grossReceiptsRial: received.toString(), grossPaymentsRial: paid.toString(), receiptsRial: received.toString(), paymentsRial: paid.toString(), netCashFlowRial: (received - paid).toString() };
  }

  async partyBalances(user: AuthenticatedUser, type: "receivable" | "payable", cursorValue?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user); this.requireReportRole(user);
    const limit = pageLimit(requestedLimit, 50, 100);
    const cursor = decodePartyBalanceCursor(cursorValue);
    if (cursor) {
      const scopedCursor = await this.prisma.party.findFirst({ where: { id: cursor.id, businessId, normalizedName: cursor.normalizedName, archivedAt: null }, select: { id: true } });
      if (!scopedCursor) throw new BadRequestException("نشانگر صفحه برای ماندهٔ طرف‌حساب معتبر نیست؛ گزارش را دوباره بارگذاری کنید.");
    }
    const rows = await this.prisma.$queryRaw<PartyBalanceRow[]>(buildPartyBalanceQuery({ businessId, branchId, type, cursor, limit: limit + 1 }));
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = hasMore ? page.at(-1) : undefined;
    return {
      items: page.map(({ normalizedName: _normalizedName, ...row }) => row),
      nextCursor: last ? encodePartyBalanceCursor({ normalizedName: last.normalizedName, id: last.id }) : null,
      hasMore,
    };
  }

  async inventory(user: AuthenticatedUser, cursor?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user); this.requireReportRole(user);
    assertUuid(cursor, "نشانگر صفحه برای گزارش موجودی معتبر نیست.");
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit) : 500;
    const where = { businessId, isActive: true, kind: "STOCK" as const, trackInventory: true };
    if (cursor && !(await this.prisma.product.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای گزارش موجودی معتبر نیست؛ گزارش را دوباره بارگذاری کنید.");
    const products = await this.prisma.product.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { unit: { select: { labelFa: true } }, balances: { where: { branchId }, take: 1 } }, orderBy: [{ normalizedName: "asc" }, { id: "asc" }], take: limit + (pageMode ? 1 : 0) });
    const mapped = products.map((product) => { const balance = product.balances[0]; const quantity = balance?.quantityOnHand ?? 0; return { productId: product.id, name: product.name, sku: product.sku, unit: product.unit.labelFa, quantity: quantity.toString(), averageCostRial: balance?.averageCostRial.toString() ?? "0", valueRial: balance?.inventoryValueRial.toString() ?? "0", low: product.reorderPoint !== null && quantity.lte(product.reorderPoint) }; });
    return pageMode ? cursorPage(mapped, limit, (product) => product.productId) : mapped;
  }

  async trialBalance(user: AuthenticatedUser, from?: string, to?: string) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("فقط مالک و حسابدار به تراز آزمایشی دسترسی دارند.");
    const range = await this.range(from, to, businessId);
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { businessId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
    const totals = accounts.length ? await this.prisma.journalLine.groupBy({ by: ["ledgerAccountId"], where: { businessId, branchId, ledgerAccountId: { in: accounts.map((account) => account.id) }, journalEntry: { status: { in: ["POSTED", "REVERSED"] }, txnDate: range } }, _sum: { debitRial: true, creditRial: true } }) : [];
    const totalByAccount = new Map(totals.map((row) => [row.ledgerAccountId, row._sum]));
    const result = accounts.map((account) => { const total = totalByAccount.get(account.id); const debit = total?.debitRial ?? 0n; const credit = total?.creditRial ?? 0n; return { code: account.code, name: account.name, debitRial: debit.toString(), creditRial: credit.toString() }; }).filter((row) => row.debitRial !== "0" || row.creditRial !== "0");
    return { accounts: result, totalDebitRial: result.reduce((sum, row) => sum + BigInt(row.debitRial), 0n).toString(), totalCreditRial: result.reduce((sum, row) => sum + BigInt(row.creditRial), 0n).toString() };
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private requireReportRole(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("به گزارش‌های مالی دسترسی ندارید."); }
  private async range(from?: string, to?: string, businessId?: string) {
    const today = businessId ? await this.businessToday(businessId) : new Date().toISOString().slice(0, 10);
    const start = this.date(from ?? today); const end = this.date(to ?? today);
    if (start > end) throw new BadRequestException("ابتدای بازه نباید بعد از انتهای آن باشد.");
    return { gte: start, lte: end };
  }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ گزارش معتبر نیست."); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ گزارش معتبر نیست."); return date; }
  private iso(date: Date) { return date.toISOString().slice(0, 10); }
  private businessToday(businessId: string) {
    // Dashboard date boundaries use the configured business timezone.
    const business = this.prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } });
    return business.then((row) => new Intl.DateTimeFormat("en-CA", { timeZone: row?.timezone ?? "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  }
}
