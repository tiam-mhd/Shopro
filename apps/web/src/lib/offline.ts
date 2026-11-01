import { openDB } from "idb";

export type PendingSale = {
  id: string;
  businessId: string;
  branchId: string;
  createdAt: string;
  draftKey: string;
  postKey: string;
  sale: { customerId?: string; txnDate: string; note?: string; lines: Array<{ productId: string; quantity: string }> };
  payment?: { amountRial: string; financeAccountId: string; method: "CASH" | "POS" | "BANK" | "OTHER" };
};

const database = openDB("shopro-offline", 1, { upgrade(db) { db.createObjectStore("sales", { keyPath: "id" }); } });

export async function savePendingSale(sale: Omit<PendingSale, "createdAt">) {
  const pending: PendingSale = { ...sale, createdAt: new Date().toISOString() };
  await (await database).put("sales", pending);
  return pending;
}

export async function listPendingSales() { return (await database).getAll("sales") as Promise<PendingSale[]>; }
export async function removePendingSale(id: string) { await (await database).delete("sales", id); }
