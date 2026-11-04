import test from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { SyncService } from "../dist/sync/sync.service.js";

const user = { id: "user-a", businessId: "business-a", branchId: "branch-a", role: "OWNER" };
const operation = (overrides = {}) => ({
  clientOperationId: "operation-a",
  deviceId: "device-a",
  operationType: "SALE_CREATE_AND_POST",
  sale: { txnDate: "2026-11-04", lines: [{ productId: "product-a", quantity: "1" }] },
  ...overrides,
});

function fixture({ createDraft, post } = {}) {
  const records = new Map();
  const invoiceNos = new Map();
  let sequence = 0;
  const prisma = {
    syncRecord: {
      async findUnique({ where }) { return records.get(`${where.businessId_deviceId_clientOperationId.businessId}:${where.businessId_deviceId_clientOperationId.deviceId}:${where.businessId_deviceId_clientOperationId.clientOperationId}`) ?? null; },
      async create({ data }) {
        const key = `${data.businessId}:${data.deviceId}:${data.clientOperationId}`;
        if (records.has(key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const now = new Date(); const row = { id: `record-${++sequence}`, ...data, serverEntityId: null, errorCode: null, createdAt: now, updatedAt: now };
        records.set(key, row); return row;
      },
      async updateMany({ where, data }) {
        const row = [...records.values()].find((candidate) => candidate.id === where.id && candidate.businessId === where.businessId && candidate.userId === where.userId && candidate.branchId === where.branchId);
        const matches = row && where.OR.some((condition) => condition.status === row.status && (!condition.updatedAt || row.updatedAt <= condition.updatedAt.lte));
        if (!matches) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
      async update({ where, data }) {
        const row = [...records.values()].find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("missing record");
        Object.assign(row, data); return row;
      },
      async findMany() { return []; },
      async findFirst() { return null; },
    },
    salesInvoice: {
      async findFirst({ where }) { return { id: where.id, invoiceNo: invoiceNos.get(where.id) ?? "S-000001" }; },
      async findMany() { return []; },
    },
  };
  const calls = { createDraft: 0, post: 0 };
  const sales = {
    async createDraft(_user, _sale, key) { calls.createDraft++; createDraft && await createDraft(); return { id: "invoice-a", key }; },
    async post(_user, _id, _dto, key) { calls.post++; post && await post(); invoiceNos.set("invoice-a", "S-000001"); return { id: "invoice-a", invoiceNo: "S-000001", status: "POSTED", key }; },
  };
  return { service: new SyncService(prisma, sales), records, calls };
}

test("offline sale operation is idempotent and replays the confirmed invoice result", async () => {
  const { service, calls } = fixture();
  const dto = operation();
  const first = await service.submitSale(user, dto, { requestId: "request-a" });
  const replay = await service.submitSale(user, dto, { requestId: "request-b" });

  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.serverInvoiceNo, "S-000001");
  assert.equal(replay.status, "SUCCEEDED");
  assert.equal(replay.serverInvoiceNo, "S-000001");
  assert.deepEqual(calls, { createDraft: 1, post: 1 });
});

test("a client operation id cannot be reused for changed data, user, or branch", async () => {
  const { service } = fixture();
  const dto = operation();
  await service.submitSale(user, dto, {});
  await assert.rejects(service.submitSale(user, operation({ sale: { ...dto.sale, note: "changed" } }), {}), (error) => error.getStatus?.() === 409);
  await assert.rejects(service.submitSale({ ...user, id: "user-b" }, dto, {}), (error) => error.getStatus?.() === 409);
  await assert.rejects(service.submitSale({ ...user, branchId: "branch-b" }, dto, {}), (error) => error.getStatus?.() === 409);
});

test("concurrent duplicate sync calls claim once and a later retry reads success", async () => {
  let releasePost;
  const postStarted = new Promise((resolve) => { releasePost = resolve; });
  let allowPost;
  const postGate = new Promise((resolve) => { allowPost = resolve; });
  const { service, calls } = fixture({ post: async () => { releasePost(); await postGate; } });
  const dto = operation();
  const firstPromise = service.submitSale(user, dto, {});
  await postStarted;
  const concurrent = await service.submitSale(user, dto, {});
  assert.equal(concurrent.status, "PROCESSING");
  allowPost();
  const first = await firstPromise;
  const replay = await service.submitSale(user, dto, {});
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(replay.status, "SUCCEEDED");
  assert.deepEqual(calls, { createDraft: 1, post: 1 });
});

test("validation conflicts stop retries while transient failures require an explicit retry", async () => {
  const conflict = fixture({ post: async () => { throw new ConflictException("conflict"); } });
  const conflictDto = operation();
  assert.equal((await conflict.service.submitSale(user, conflictDto, {})).status, "CONFLICT");
  assert.equal((await conflict.service.submitSale(user, conflictDto, {})).status, "CONFLICT");
  assert.equal(conflict.calls.post, 1);

  let failOnce = true;
  const transient = fixture({ post: async () => { if (failOnce) { failOnce = false; throw new Error("temporary"); } } });
  const transientDto = operation({ clientOperationId: "operation-b" });
  assert.equal((await transient.service.submitSale(user, transientDto, {})).status, "FAILED");
  assert.equal((await transient.service.submitSale(user, transientDto, {})).status, "FAILED");
  assert.equal(transient.calls.post, 1);
  assert.equal((await transient.service.submitSale(user, { ...transientDto, retryFailed: true }, {})).status, "SUCCEEDED");
  assert.equal(transient.calls.post, 2);
});
