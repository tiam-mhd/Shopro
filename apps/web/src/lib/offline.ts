import { openDB } from "idb";
import type { OfflineConflictType, OfflineQueueStatus } from "./offline-state.js";

type SaleDraft = {
  customerId?: string;
  txnDate: string;
  note?: string;
  lines: Array<{ productId: string; quantity: string }>;
};

type SalePayment = { amountRial: string; financeAccountId: string; method: "CASH" | "POS" | "BANK" | "OTHER" };

export type PendingSale = {
  id: string;
  userId: string;
  businessId: string;
  branchId: string;
  createdAt: string;
  draftKey: string;
  postKey: string;
  status: OfflineQueueStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  retryable: boolean;
  conflictType: OfflineConflictType;
  completedAt: string | null;
  serverInvoiceNo: string | null;
  sale?: SaleDraft;
  payment?: SalePayment;
};

export type NewPendingSale = Pick<PendingSale, "id" | "userId" | "businessId" | "branchId" | "draftKey" | "postKey"> & {
  sale: SaleDraft;
  payment?: SalePayment;
};

type StoredSale = Record<string, unknown> & { id?: unknown };

const KEEP_SUCCEEDED_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_SYNC_MS = 5 * 60 * 1000;
const validStatuses = new Set<OfflineQueueStatus>(["pending", "syncing", "succeeded", "failed", "conflict"]);
const database = openDB("shopro-offline", 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("sales")) db.createObjectStore("sales", { keyPath: "id" });
  },
});

export async function savePendingSale(sale: NewPendingSale) {
  const pending: PendingSale = {
    ...sale,
    createdAt: new Date().toISOString(),
    status: "pending",
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    retryable: true,
    conflictType: null,
    completedAt: null,
    serverInvoiceNo: null,
  };
  await (await database).put("sales", pending);
  return pending;
}

export async function listPendingSales() {
  const db = await database;
  const rawRows = await db.getAll("sales") as StoredSale[];
  const rows: PendingSale[] = [];
  const now = Date.now();
  for (const raw of rawRows) {
    const row = normalizeStoredSale(raw, now);
    if (!row) continue;
    const successDate = Date.parse(row.completedAt ?? row.createdAt);
    if (row.status === "succeeded" && Number.isFinite(successDate) && now - successDate > KEEP_SUCCEEDED_MS) {
      await db.delete("sales", row.id);
      continue;
    }
    rows.push(row);
    await db.put("sales", row);
  }
  return rows;
}

export function countAwaitingServer(rows: PendingSale[]) {
  return rows.reduce((count, row) => count + (row.status === "succeeded" ? 0 : 1), 0);
}

export async function countUnclaimedPendingSales() {
  const rows = await (await database).getAll("sales") as StoredSale[];
  return rows.filter((row) => !isOwnedQueueEntry(row) && typeof row.id === "string").length;
}

export async function removeUnclaimedPendingSales() {
  const db = await database;
  const rows = await db.getAll("sales") as StoredSale[];
  const ids = rows.filter((row) => !isOwnedQueueEntry(row) && typeof row.id === "string").map((row) => row.id as string);
  const tx = db.transaction("sales", "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
  return ids.length;
}

export async function removePendingSale(id: string) { await (await database).delete("sales", id); }

export async function markPendingSaleSyncing(id: string) {
  await updatePendingSale(id, (sale) => ({
    ...sale,
    status: "syncing",
    attemptCount: sale.attemptCount + 1,
    lastAttemptAt: new Date().toISOString(),
    lastError: null,
    retryable: false,
    conflictType: null,
  }));
}

export async function markPendingSaleForRetry(id: string) {
  await updatePendingSale(id, (sale) => ({ ...sale, status: "pending", lastError: null, retryable: true, conflictType: null }));
}

export async function markPendingSaleFailed(id: string, lastError: string, retryable: boolean) {
  await updatePendingSale(id, (sale) => ({
    ...sale,
    status: retryable ? "failed" : "conflict",
    lastError,
    retryable,
    conflictType: retryable ? null : "server",
  }));
}

export async function markPendingSaleScopeConflict(id: string, message: string) {
  await updatePendingSale(id, (sale) => ({ ...sale, status: "conflict", lastError: message, retryable: false, conflictType: "scope" }));
}

export async function markPendingSaleSucceeded(id: string, invoiceNo?: string) {
  await updatePendingSale(id, (sale) => {
    const { sale: _sale, payment: _payment, ...metadata } = sale;
    return {
      ...metadata,
      status: "succeeded",
      lastError: null,
      retryable: false,
      conflictType: null,
      completedAt: new Date().toISOString(),
      serverInvoiceNo: invoiceNo ?? null,
    };
  });
}

async function updatePendingSale(id: string, update: (sale: PendingSale) => PendingSale) {
  const db = await database;
  const raw = await db.get("sales", id) as StoredSale | undefined;
  if (!raw) return;
  const current = normalizeStoredSale(raw, Date.now());
  if (current) await db.put("sales", update(current));
}

function normalizeStoredSale(row: StoredSale, now: number): PendingSale | null {
  if (typeof row.id !== "string" || typeof row.userId !== "string" || typeof row.businessId !== "string" ||
      typeof row.branchId !== "string" || typeof row.draftKey !== "string" || typeof row.postKey !== "string") return null;

  const isSuccess = row.status === "succeeded";
  const sale = isSaleDraft(row.sale) ? row.sale : undefined;
  if (!isSuccess && !sale) return null;
  let status = validStatuses.has(row.status as OfflineQueueStatus)
    ? row.status as OfflineQueueStatus
    : row.lastError ? "failed" : "pending";
  const lastAttemptAt = typeof row.lastAttemptAt === "string" ? row.lastAttemptAt : null;
  if (status === "syncing" && (!lastAttemptAt || now - Date.parse(lastAttemptAt) > STALE_SYNC_MS)) status = "pending";
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : new Date(now).toISOString();
  const attemptCount = Number.isSafeInteger(row.attemptCount) && Number(row.attemptCount) >= 0 ? Number(row.attemptCount) : 0;
  const lastError = typeof row.lastError === "string" ? row.lastError : null;
  const completedAt = typeof row.completedAt === "string" ? row.completedAt : null;
  const conflictType = row.conflictType === "scope" || row.conflictType === "server" ? row.conflictType : null;
  const payment = isSalePayment(row.payment) ? row.payment : undefined;
  return {
    id: row.id,
    userId: row.userId,
    businessId: row.businessId,
    branchId: row.branchId,
    createdAt,
    draftKey: row.draftKey,
    postKey: row.postKey,
    status,
    attemptCount,
    lastAttemptAt,
    lastError,
    retryable: typeof row.retryable === "boolean" ? row.retryable : status === "pending" || status === "failed",
    conflictType,
    completedAt,
    serverInvoiceNo: typeof row.serverInvoiceNo === "string" ? row.serverInvoiceNo : null,
    ...(sale ? { sale } : {}),
    ...(payment ? { payment } : {}),
  };
}

function isOwnedQueueEntry(row: StoredSale): boolean {
  if (typeof row.id !== "string" || typeof row.userId !== "string" || typeof row.businessId !== "string" ||
      typeof row.branchId !== "string" || typeof row.draftKey !== "string" || typeof row.postKey !== "string") return false;
  return row.status === "succeeded" || isSaleDraft(row.sale);
}

function isSaleDraft(value: unknown): value is SaleDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SaleDraft>;
  return typeof draft.txnDate === "string" && Array.isArray(draft.lines) && draft.lines.every((line) =>
    Boolean(line) && typeof line.productId === "string" && typeof line.quantity === "string");
}

function isSalePayment(value: unknown): value is SalePayment {
  if (!value || typeof value !== "object") return false;
  const payment = value as Partial<SalePayment>;
  return typeof payment.amountRial === "string" && typeof payment.financeAccountId === "string" &&
    ["CASH", "POS", "BANK", "OTHER"].includes(payment.method ?? "");
}
