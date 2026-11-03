import { openDB } from "idb";

export type PendingSale = {
  id: string;
  userId: string;
  businessId: string;
  branchId: string;
  createdAt: string;
  draftKey: string;
  postKey: string;
  lastError?: string | null;
  sale: { customerId?: string; txnDate: string; note?: string; lines: Array<{ productId: string; quantity: string }> };
  payment?: { amountRial: string; financeAccountId: string; method: "CASH" | "POS" | "BANK" | "OTHER" };
};

type StoredSale = Partial<PendingSale> & { id?: unknown };

const database = openDB("shopro-offline", 1, { upgrade(db) { db.createObjectStore("sales", { keyPath: "id" }); } });

export async function savePendingSale(sale: Omit<PendingSale, "createdAt">) {
  const pending: PendingSale = { ...sale, createdAt: new Date().toISOString() };
  await (await database).put("sales", pending);
  return pending;
}

export async function listPendingSales() {
  const rows = await (await database).getAll("sales") as StoredSale[];
  return rows.filter(isOwnedQueueEntry) as PendingSale[];
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
export async function setPendingSaleError(id: string, lastError: string | null) {
  const db = await database;
  const sale = await db.get("sales", id) as PendingSale | undefined;
  if (sale) await db.put("sales", { ...sale, lastError });
}

function isOwnedQueueEntry(row: StoredSale): row is PendingSale {
  return typeof row.id === "string" && typeof row.userId === "string" && typeof row.businessId === "string" &&
    typeof row.branchId === "string" && typeof row.draftKey === "string" && typeof row.postKey === "string" &&
    typeof row.sale?.txnDate === "string" && Array.isArray(row.sale.lines);
}
