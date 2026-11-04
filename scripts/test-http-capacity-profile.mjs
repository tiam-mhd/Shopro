import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../apps/api/dist/app.module.js";
import { ApiExceptionFilter } from "../apps/api/dist/common/api-exception.filter.js";
import { performance } from "node:perf_hooks";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const percentile = (values, ratio) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)].toFixed(1));
};

export async function runHttpCapacityProfile({ prisma, businessId, branchId, customerId, statementPartyId, productId }) {
  const virtualUsers = Number(process.env.SHOPRO_PERF_VUS ?? 20);
  const durationMs = Number(process.env.SHOPRO_PERF_DURATION_MS ?? 300_000);
  const listBudgetMs = Number(process.env.SHOPRO_PERF_LIST_P95_BUDGET_MS ?? 800);
  const reportBudgetMs = Number(process.env.SHOPRO_PERF_REPORT_P95_BUDGET_MS ?? 2_000);
  const postingBudgetMs = Number(process.env.SHOPRO_PERF_POST_P95_BUDGET_MS ?? 1_500);
  if (!Number.isInteger(virtualUsers) || virtualUsers < 1 || virtualUsers > 100) throw new Error("SHOPRO_PERF_VUS must be an integer between 1 and 100.");
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 3_600_000) throw new Error("SHOPRO_PERF_DURATION_MS must be between 1,000 and 3,600,000.");
  for (const [label, model, minimum] of [["products", prisma.product, 10_000], ["parties", prisma.party, 10_000], ["journal lines", prisma.journalLine, 100_000]]) {
    const count = await model.count({ where: { businessId } });
    assert.ok(count >= minimum, `Capacity profile requires at least ${minimum} ${label}; found ${count}.`);
  }

  const revenueAccount = await prisma.ledgerAccount.findUnique({ where: { businessId_systemKey: { businessId, systemKey: "sales_revenue" } }, select: { id: true } })
    ?? await prisma.ledgerAccount.create({ data: { businessId, code: "4000", name: "درآمد فروش آزمایش ظرفیت", type: "REVENUE", systemKey: "sales_revenue" }, select: { id: true } });
  assert.ok(revenueAccount.id);

  const user = await prisma.user.create({ data: { phone: `09${String(Date.now()).slice(-9)}`, displayName: "HTTP capacity fixture" } });
  const member = await prisma.businessMember.create({ data: { businessId, userId: user.id, role: "OWNER" } });
  await prisma.memberBranch.create({ data: { businessId, memberId: member.id, branchId } });
  const rawSession = randomUUID();
  const csrf = randomUUID();
  await prisma.userSession.create({ data: { userId: user.id, tokenHash: hash(rawSession), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + durationMs + 60_000) } });

  let app;
  try {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    const headers = {
      cookie: `shopro_session=${rawSession}; shopro_csrf=${csrf}`,
      "x-csrf-token": csrf,
      "x-business-id": businessId,
      "x-branch-id": branchId,
    };

    const from = "2026-11-01";
    const to = "2026-11-02";
    const readRoutes = [
      ["product search", `/products?q=perf%20product&limit=50`],
      ["party search", `/parties?q=balance-&type=CUSTOMER&limit=50`],
      ["sales list", `/sales?limit=50`],
      ["dashboard", `/reports/dashboard?from=${from}&to=${to}`],
      ["party statement", `/parties/${statementPartyId}/statement?through=${to}&limit=100`],
      ["receivables", `/reports/receivables?limit=50`],
      ["profit and loss", `/reports/profit-loss?from=${from}&to=${to}`],
      ["cash flow", `/reports/cash-flow?from=${from}&to=${to}`],
      ["trial balance", `/reports/trial-balance?from=${from}&to=${to}`],
    ];
    const stats = new Map(readRoutes.map(([name]) => [name, { latencies: [], failed: 0 }]));
    stats.set("financial sale posting", { latencies: [], failed: 0 });
    const errors = [];
    let requests = 0;
    let successfulSales = 0;
    let peakDatabaseConnections = 0;
    let peakRssBytes = process.memoryUsage().rss;
    let profileTimer;
    let monitorQuery = Promise.resolve();
    const recordFailure = (name, detail) => {
      const row = stats.get(name);
      row.failed++;
      if (errors.length < 20) errors.push({ endpoint: name, detail });
    };
    const get = async (name, path) => {
      const started = performance.now();
      requests++;
      try {
        const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
        const body = await response.text();
        stats.get(name).latencies.push(performance.now() - started);
        if (!response.ok) recordFailure(name, `HTTP ${response.status}: ${body.slice(0, 160)}`);
      } catch (error) {
        stats.get(name).latencies.push(performance.now() - started);
        recordFailure(name, error instanceof Error ? error.name : "network error");
      }
    };
    const postSale = async () => {
      const name = "financial sale posting";
      const started = performance.now();
      try {
        const create = await fetch(`${baseUrl}/sales`, {
          method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": `capacity-draft-${randomUUID()}` },
          body: JSON.stringify({ customerId, txnDate: to, lines: [{ productId, quantity: "1" }] }), signal: AbortSignal.timeout(10_000),
        });
        const draft = await create.json();
        if (!create.ok || typeof draft.id !== "string") throw new Error(`draft HTTP ${create.status}`);
        const post = await fetch(`${baseUrl}/sales/${draft.id}/post`, {
          method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": `capacity-post-${randomUUID()}` },
          body: "{}", signal: AbortSignal.timeout(15_000),
        });
        const result = await post.json();
        if (!post.ok || result.status !== "POSTED") throw new Error(`post HTTP ${post.status}`);
        successfulSales++;
      } catch (error) {
        recordFailure(name, error instanceof Error ? error.message.slice(0, 160) : "request failed");
      } finally {
        stats.get(name).latencies.push(performance.now() - started);
      }
    };

    const endsAt = Date.now() + durationMs;
    const profileStartedAt = performance.now();
    const cpuStartedAt = process.cpuUsage();
    const initialRssBytes = process.memoryUsage().rss;
    try {
      profileTimer = setInterval(() => {
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        monitorQuery = monitorQuery.then(async () => {
          const rows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`;
          peakDatabaseConnections = Math.max(peakDatabaseConnections, rows[0]?.count ?? 0);
        }).catch(() => undefined);
      }, 1_000);
      await Promise.all(Array.from({ length: virtualUsers }, async (_, virtualUser) => {
        let iteration = 0;
        do {
          for (const [name, path] of readRoutes) await get(name, path);
          if ((iteration + virtualUser) % 10 === 0) await postSale();
          iteration++;
        } while (Date.now() < endsAt);
      }));
    } catch (error) {
      console.error(`HTTP capacity profile stopped early: ${JSON.stringify(errors)}`);
      throw error;
    } finally {
      if (profileTimer) clearInterval(profileTimer);
      await monitorQuery;
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);

    const summary = Object.fromEntries([...stats].map(([name, row]) => [name, {
      count: row.latencies.length,
      errors: row.failed,
      p50Ms: percentile(row.latencies, 0.5),
      p95Ms: percentile(row.latencies, 0.95),
      p99Ms: percentile(row.latencies, 0.99),
      maxMs: row.latencies.length ? Number(row.latencies.reduce((maximum, value) => Math.max(maximum, value), 0).toFixed(1)) : null,
    }]));
    const postedInvoices = await prisma.salesInvoice.findMany({
      where: { businessId, branchId, customerId, status: "POSTED", txnDate: new Date(`${to}T00:00:00.000Z`) },
      select: { id: true, invoiceNo: true, totalRial: true },
    });
    assert.equal(postedInvoices.length, successfulSales, "each successful HTTP posting should create exactly one posted invoice");
    assert.equal(new Set(postedInvoices.map(({ invoiceNo }) => invoiceNo)).size, postedInvoices.length, "posted financial document numbers must be unique");
    const journals = await prisma.journalEntry.findMany({
      where: { businessId, branchId, sourceType: "SALE", sourceId: { in: postedInvoices.map(({ id }) => id) }, status: "POSTED" },
      include: { lines: { select: { ledgerAccountId: true, debitRial: true, creditRial: true } } },
    });
    assert.equal(journals.length, postedInvoices.length, "each posted invoice must have one posted journal");
    const receivableAccount = await prisma.ledgerAccount.findUniqueOrThrow({ where: { businessId_systemKey: { businessId, systemKey: "accounts_receivable" } }, select: { id: true } });
    const invoiceById = new Map(postedInvoices.map((invoice) => [invoice.id, invoice]));
    for (const journal of journals) {
      const debit = journal.lines.reduce((sum, line) => sum + line.debitRial, 0n);
      const credit = journal.lines.reduce((sum, line) => sum + line.creditRial, 0n);
      const receivable = journal.lines.filter((line) => line.ledgerAccountId === receivableAccount.id).reduce((sum, line) => sum + line.debitRial - line.creditRial, 0n);
      assert.equal(debit, credit, `journal ${journal.id} must balance`);
      assert.equal(receivable, invoiceById.get(journal.sourceId).totalRial, `journal ${journal.id} must reconcile to its invoice total`);
    }
    const elapsedSeconds = (performance.now() - profileStartedAt) / 1_000;
    const cpuUsed = process.cpuUsage(cpuStartedAt);
    const runtime = {
      elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
      readsPerSecond: Number((requests / elapsedSeconds).toFixed(1)),
      postingsPerSecond: Number((successfulSales / elapsedSeconds).toFixed(2)),
      processCpuPercent: Number((((cpuUsed.user + cpuUsed.system) / 1_000_000 / elapsedSeconds) * 100).toFixed(1)),
      processRssStartMiB: Number((initialRssBytes / 1024 / 1024).toFixed(1)),
      processRssPeakMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
      processRssEndMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      databaseConnectionsPeak: peakDatabaseConnections,
    };
    console.log(`HTTP capacity profile (${virtualUsers} VUs, ${(durationMs / 1000).toFixed(0)}s, ${requests} reads, ${successfulSales} posted sales): runtime=${JSON.stringify(runtime)} routes=${JSON.stringify(summary)}`);
    if (errors.length) console.error(`HTTP capacity errors (first ${errors.length}): ${JSON.stringify(errors)}`);
    const totalErrors = [...stats.values()].reduce((sum, row) => sum + row.failed, 0);
    assert.equal(totalErrors, 0, `capacity profile observed ${totalErrors} failed requests`);
    for (const [name, row] of stats) {
      assert.ok(row.latencies.length > 0, `capacity profile did not exercise ${name}`);
      const listRoute = name === "product search" || name === "party search" || name === "sales list";
      const budget = name === "financial sale posting" ? postingBudgetMs : listRoute ? listBudgetMs : reportBudgetMs;
      const p95 = percentile(row.latencies, 0.95);
      assert.ok(p95 <= budget, `${name} p95 ${p95}ms exceeds the local budget of ${budget}ms`);
    }
    assert.ok(successfulSales >= virtualUsers, "the profile must post repeated financial documents, not only read endpoints");
    console.log(`HTTP capacity profile passed: all endpoints had zero errors; ${journals.length} posted journals balanced and matched their invoice totals; p95 budgets ${listBudgetMs}ms for list/search, ${reportBudgetMs}ms for reports, and ${postingBudgetMs}ms for posting.`);
  } finally {
    if (app) await app.close();
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}
