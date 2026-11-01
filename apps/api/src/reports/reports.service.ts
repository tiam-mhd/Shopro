import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../common/request-context.js";

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
      this.prisma.cashTransaction.aggregate({ where: { businessId, branchId, kind: "RECEIPT", status: "POSTED", txnDate: range }, _sum: { amountRial: true } }),
      this.prisma.financeAccount.findMany({ where: { businessId, branchId, isActive: true }, select: { id: true, name: true, ledgerAccountId: true, kind: true } }),
      this.prisma.product.findMany({ where: { businessId, isActive: true, trackInventory: true, reorderPoint: { not: null } }, include: { unit: { select: { labelFa: true } }, balances: { where: { branchId }, select: { quantityOnHand: true } } }, take: 500 }),
      this.prisma.salesInvoice.findMany({ where: { businessId, branchId, status: "POSTED", txnDate: range }, select: { id: true, txnDate: true, totalRial: true, allocations: { select: { amountRial: true } } } }),
      this.prisma.salesInvoiceLine.findMany({ where: { businessId, invoice: { businessId, branchId, status: "POSTED", txnDate: range } }, select: { cogsRial: true, product: { select: { kind: true, trackInventory: true } }, lineTotalRial: true, discountRial: true, taxRial: true } }),
      this.prisma.salesInvoice.groupBy({ by: ["txnDate"], where: { businessId, branchId, status: "POSTED", txnDate: range }, _sum: { totalRial: true }, orderBy: { txnDate: "asc" } }),
      this.prisma.salesInvoice.count({ where: { businessId, branchId, status: "POSTED", returnOfId: null, txnDate: range } }),
    ]);
    const accountSums = await this.prisma.journalLine.groupBy({ by: ["ledgerAccountId"], where: { businessId, branchId, ledgerAccountId: { in: accounts.map((account) => account.ledgerAccountId) }, journalEntry: { status: "POSTED" } }, _sum: { debitRial: true, creditRial: true } });
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
    const rows = await this.prisma.journalLine.findMany({ where: { businessId, branchId, journalEntry: { status: "POSTED", txnDate: date } }, include: { ledgerAccount: { select: { code: true, name: true, type: true, systemKey: true } } } });
    const values = new Map<string, { account: string; type: string; debit: bigint; credit: bigint }>();
    for (const row of rows) {
      if (!["REVENUE", "EXPENSE"].includes(row.ledgerAccount.type)) continue;
      const old = values.get(row.ledgerAccountId) ?? { account: row.ledgerAccount.name, type: row.ledgerAccount.type, debit: 0n, credit: 0n };
      old.debit += row.debitRial; old.credit += row.creditRial; values.set(row.ledgerAccountId, old);
    }
    const entries = [...values].map(([id, value]) => ({ id, name: value.account, type: value.type, amountRial: (value.type === "REVENUE" ? value.credit - value.debit : value.debit - value.credit).toString() }));
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
    return { range: { from: from ?? this.iso(date.gte), to: to ?? this.iso(date.lte) }, receiptsRial: received.toString(), paymentsRial: paid.toString(), netCashFlowRial: (received - paid).toString() };
  }

  async partyBalances(user: AuthenticatedUser, type: "receivable" | "payable") {
    const { businessId, branchId } = this.scope(user); this.requireReportRole(user);
    const key = type === "receivable" ? "accounts_receivable" : "accounts_payable";
    const rows = await this.prisma.journalLine.findMany({ where: { businessId, branchId, partyId: { not: null }, ledgerAccount: { systemKey: key }, journalEntry: { status: "POSTED" } }, include: { party: { select: { id: true, name: true, phone: true } } } });
    const balances = new Map<string, { party: { id: string; name: string; phone: string | null }; amount: bigint }>();
    for (const line of rows) {
      if (!line.party) continue;
      const current = balances.get(line.party.id) ?? { party: line.party, amount: 0n };
      current.amount += type === "receivable" ? line.debitRial - line.creditRial : line.creditRial - line.debitRial;
      balances.set(line.party.id, current);
    }
    return [...balances.values()].filter((row) => row.amount > 0n).map(({ party, amount }) => ({ ...party, balanceRial: amount.toString() })).sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }

  async inventory(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user); this.requireReportRole(user);
    const products = await this.prisma.product.findMany({ where: { businessId, isActive: true, kind: "STOCK", trackInventory: true }, include: { unit: { select: { labelFa: true } }, balances: { where: { branchId }, take: 1 } }, orderBy: { normalizedName: "asc" }, take: 500 });
    return products.map((product) => { const balance = product.balances[0]; const quantity = balance?.quantityOnHand ?? 0; return { productId: product.id, name: product.name, sku: product.sku, unit: product.unit.labelFa, quantity: quantity.toString(), averageCostRial: balance?.averageCostRial.toString() ?? "0", valueRial: balance?.inventoryValueRial.toString() ?? "0", low: product.reorderPoint !== null && quantity.lte(product.reorderPoint) }; });
  }

  async trialBalance(user: AuthenticatedUser, from?: string, to?: string) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("فقط مالک و حسابدار به تراز آزمایشی دسترسی دارند.");
    const range = await this.range(from, to, businessId);
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { businessId, isActive: true }, include: { lines: { where: { branchId, journalEntry: { status: "POSTED", txnDate: range }, businessId }, select: { debitRial: true, creditRial: true } } }, orderBy: { code: "asc" } });
    const result = accounts.map((account) => { const debit = account.lines.reduce((sum, line) => sum + line.debitRial, 0n); const credit = account.lines.reduce((sum, line) => sum + line.creditRial, 0n); return { code: account.code, name: account.name, debitRial: debit.toString(), creditRial: credit.toString() }; }).filter((row) => row.debitRial !== "0" || row.creditRial !== "0");
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
