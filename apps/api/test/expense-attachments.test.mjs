import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { prepareExpenseAttachment, MAX_ATTACHMENT_BYTES } from "../dist/expenses/attachment-files.js";
import { createAttachmentDownloadGrant, verifyAttachmentDownloadGrant } from "../dist/expenses/attachment-download-token.js";
import { AttachmentStorageService } from "../dist/expenses/attachment-storage.service.js";
import { ExpensesService } from "../dist/expenses/expenses.service.js";

test("expense attachment validation trusts file signatures and sanitizes user filenames", () => {
  const bytes = Buffer.from("%PDF-1.7\nbody");
  const prepared = prepareExpenseAttachment({ originalname: "..\\رسید\u0000\".pdf", buffer: bytes, size: bytes.length });
  assert.equal(prepared.mimeType, "application/pdf");
  assert.equal(prepared.extension, "pdf");
  assert.equal(prepared.fileName.includes("\u0000"), false);
  assert.equal(prepared.checksum.length, 64);
  assert.throws(() => prepareExpenseAttachment({ originalname: "receipt.pdf", buffer: Buffer.from("not a PDF") }), BadRequestException);
  assert.throws(() => prepareExpenseAttachment({ originalname: "empty.pdf", buffer: Buffer.alloc(0) }), BadRequestException);
  assert.throws(() => prepareExpenseAttachment({ originalname: "huge.pdf", buffer: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) }), BadRequestException);
});

test("attachment storage is private, uses opaque keys, and supports bounded read and removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shopro-private-attachments-"));
  const previous = process.env.ATTACHMENT_STORAGE_DIR;
  process.env.ATTACHMENT_STORAGE_DIR = directory;
  const storage = new AttachmentStorageService();
  const key = "00000000-0000-4000-8000-000000000001.pdf";
  const bytes = Buffer.from("%PDF-1.7\nprivate");
  try {
    await storage.save(key, bytes);
    assert.deepEqual(await storage.read(key), bytes);
    assert.equal((await readFile(join(directory, key))).equals(bytes), true);
    await assert.rejects(storage.save(key, bytes));
    await assert.rejects(storage.read("..\\outside.pdf"));
    await storage.remove(key);
    await assert.rejects(storage.read(key));
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("attachment storage refuses missing roots, public roots, and symbolic-link files", async (context) => {
  const previous = process.env.ATTACHMENT_STORAGE_DIR;
  const storage = new AttachmentStorageService();
  const key = "00000000-0000-4000-8000-000000000002.png";
  try {
    delete process.env.ATTACHMENT_STORAGE_DIR;
    await assert.rejects(storage.read(key), ServiceUnavailableException);
    process.env.ATTACHMENT_STORAGE_DIR = join(process.cwd(), "apps", "web", "public", "private-test");
    await assert.rejects(storage.save(key, Buffer.from("x")), ServiceUnavailableException);

    const directory = await mkdtemp(join(tmpdir(), "shopro-private-attachments-link-"));
    try {
      const target = join(directory, "target");
      await writeFile(target, Buffer.from("not a permitted attachment"));
      const linkName = "00000000-0000-4000-8000-000000000003.pdf";
      try { await symlink(target, join(directory, linkName)); }
      catch { context.skip("این محیط اجازهٔ ساخت symbolic link را نمی‌دهد."); return; }
      process.env.ATTACHMENT_STORAGE_DIR = directory;
      await assert.rejects(storage.read(linkName));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = previous;
  }
});

test("expense attachments are branch-scoped, owner-managed, and atomically audited without filenames", async () => {
  const audit = [];
  const attachmentCreates = [];
  const expenseFinds = [];
  const transactionOrder = [];
  const bytes = Buffer.from("%PDF-1.7\nreceipt");
  const tx = {
    $queryRaw: async () => { transactionOrder.push("backup-lock"); },
    expense: {
      findFirst: async (query) => { expenseFinds.push(query); return { id: "expense-a", status: "DRAFT", attachmentId: null }; },
      update: async ({ where, data }) => ({ id: where.id, ...data }),
    },
    attachment: { create: async ({ data }) => { attachmentCreates.push(data); return { ...data, createdAt: new Date("2026-11-03T10:00:00Z") }; } },
    auditEvent: { create: async ({ data }) => { audit.push(data); return data; } },
  };
  const prisma = {
    expense: { findFirst: async (query) => { expenseFinds.push(query); return { id: "expense-a", status: "DRAFT", attachmentId: null }; } },
    $transaction: async (callback) => callback(tx),
  };
  const stored = [];
  const storage = { save: async (key, value) => stored.push({ key, value }), remove: async () => undefined };
  const service = new ExpensesService(prisma, {}, storage);
  const result = await service.uploadAttachment({ id: "user-a", businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "00000000-0000-4000-8000-000000000010", { originalname: "receipt.pdf", buffer: bytes }, { requestId: "request-a" });
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.fileName, "receipt.pdf");
  assert.equal(stored.length, 1);
  assert.equal(expenseFinds.every((query) => query.where.businessId === "business-a" && query.where.branchId === "branch-a"), true);
  assert.equal(attachmentCreates[0].uploadedBy, "user-a");
  assert.equal(audit[0].requestId, "request-a");
  assert.equal(JSON.stringify(audit[0]).includes("receipt.pdf"), false);
  assert.equal(transactionOrder[0], "backup-lock");

  await assert.rejects(service.uploadAttachment({ id: "cashier-a", businessId: "business-a", branchId: "branch-a", role: "CASHIER" }, "00000000-0000-4000-8000-000000000010", { originalname: "receipt.pdf", buffer: bytes }, {}), ForbiddenException);
  const isolated = new ExpensesService({ expense: { findFirst: async (query) => { assert.equal(query.where.businessId, "business-b"); assert.equal(query.where.branchId, "branch-b"); return null; } } }, {}, { save: async () => assert.fail("must not store an inaccessible attachment") });
  await assert.rejects(isolated.uploadAttachment({ id: "owner-b", businessId: "business-b", branchId: "branch-b", role: "OWNER" }, "00000000-0000-4000-8000-000000000010", { originalname: "receipt.pdf", buffer: bytes }, {}), NotFoundException);
});

test("expense attachment removal requires an editable draft and deletes storage only after its audit transaction", async () => {
  const sequence = [];
  const tx = {
    $queryRaw: async () => { sequence.push("backup-lock"); },
    expense: {
      findFirst: async ({ where }) => { assert.deepEqual(where, { id: "00000000-0000-4000-8000-000000000020", businessId: "business-a", branchId: "branch-a" }); return { id: where.id, status: "DRAFT", attachmentId: "00000000-0000-4000-8000-000000000021" }; },
      update: async ({ data }) => { sequence.push(data.attachmentId === null ? "detach" : "unexpected"); return {}; },
      count: async () => 0,
    },
    attachment: {
      findFirst: async () => ({ id: "00000000-0000-4000-8000-000000000021", storageKey: "00000000-0000-4000-8000-000000000021.pdf" }),
      delete: async () => { sequence.push("metadata-delete"); return {}; },
    },
    auditEvent: { create: async () => { sequence.push("audit"); return {}; } },
  };
  const service = new ExpensesService({ $transaction: async (callback) => callback(tx) }, {}, { remove: async () => { assert.deepEqual(sequence, ["backup-lock", "detach", "metadata-delete", "audit"]); sequence.push("file-delete"); } });
  const result = await service.removeAttachment({ id: "owner-a", businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "00000000-0000-4000-8000-000000000020", { requestId: "request-remove" });
  assert.deepEqual(result, { id: "00000000-0000-4000-8000-000000000020", removed: true });
  assert.deepEqual(sequence, ["backup-lock", "detach", "metadata-delete", "audit", "file-delete"]);
  await assert.rejects(service.removeAttachment({ id: "cashier-a", businessId: "business-a", branchId: "branch-a", role: "CASHIER" }, "00000000-0000-4000-8000-000000000020", {}), ForbiddenException);
});

test("deleting an expense draft participates in the attachment backup lock", async () => {
  const sequence = [];
  const tx = {
    $queryRaw: async () => { sequence.push("backup-lock"); },
    expense: {
      findFirst: async ({ where }) => { sequence.push("read-draft"); assert.equal(where.status, "DRAFT"); return { id: where.id, expenseNo: null, amountRial: 50n, taxRial: 0n, attachmentId: null }; },
      delete: async ({ where }) => { sequence.push("delete-draft"); return { id: where.id }; },
    },
    auditEvent: { create: async () => { sequence.push("audit"); return {}; } },
  };
  const service = new ExpensesService({ $transaction: async (callback) => callback(tx) }, {}, {});
  const result = await service.deleteDraft({ id: "owner-a", businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "00000000-0000-4000-8000-000000000050", { requestId: "delete-draft" });
  assert.deepEqual(result, { id: "00000000-0000-4000-8000-000000000050", status: "DELETED" });
  assert.deepEqual(sequence, ["backup-lock", "read-draft", "audit", "delete-draft"]);
});

test("expense attachment download verifies its checksum and branch scope", async () => {
  const bytes = Buffer.from("%PDF-1.7\nfile-integrity");
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "s".repeat(32);
  let query;
  try {
    const service = new ExpensesService({ expense: { findFirst: async (input) => { query = input; return { attachment: { id: "00000000-0000-4000-8000-000000000031", storageKey: "00000000-0000-4000-8000-000000000031.pdf", fileName: "receipt.pdf", mimeType: "application/pdf", bytes: BigInt(bytes.length), checksum: createHash("sha256").update(bytes).digest("hex") } }; } } }, {}, { read: async () => bytes });
    const user = { id: "00000000-0000-4000-8000-000000000032", businessId: "00000000-0000-4000-8000-000000000033", branchId: "00000000-0000-4000-8000-000000000034", role: "OWNER" };
    const expenseId = "00000000-0000-4000-8000-000000000030";
    const grant = await service.issueAttachmentDownloadToken(user, expenseId);
    const downloaded = await service.downloadAttachment(user, expenseId, grant.token);
    assert.deepEqual(downloaded.bytes, bytes);
    assert.equal(query.where.businessId, user.businessId);
    assert.equal(query.where.branchId, user.branchId);

    const corrupt = new ExpensesService({ expense: { findFirst: async () => ({ attachment: { id: "00000000-0000-4000-8000-000000000031", storageKey: "00000000-0000-4000-8000-000000000031.pdf", fileName: "receipt.pdf", mimeType: "application/pdf", bytes: BigInt(bytes.length), checksum: "0".repeat(64) } }) } }, {}, { read: async () => bytes });
    await assert.rejects(corrupt.downloadAttachment(user, expenseId, grant.token), ConflictException);
    await assert.rejects(corrupt.downloadAttachment({ ...user, branchId: "00000000-0000-4000-8000-000000000035" }, expenseId, grant.token), UnauthorizedException);
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("attachment download grants expire, are scope-bound, and reject changed signatures", () => {
  const secret = "k".repeat(32);
  const expected = { expenseId: "00000000-0000-4000-8000-000000000040", attachmentId: "00000000-0000-4000-8000-000000000041", businessId: "00000000-0000-4000-8000-000000000042", branchId: "00000000-0000-4000-8000-000000000043", userId: "00000000-0000-4000-8000-000000000044" };
  const issued = createAttachmentDownloadGrant(expected, secret, 1_000_000);
  assert.equal(verifyAttachmentDownloadGrant(issued.token, secret, expected, 1_010_000), true);
  assert.equal(verifyAttachmentDownloadGrant(issued.token, secret, expected, 1_061_000), false);
  assert.equal(verifyAttachmentDownloadGrant(issued.token, secret, { ...expected, branchId: "00000000-0000-4000-8000-000000000045" }, 1_010_000), false);
  assert.equal(verifyAttachmentDownloadGrant(`${issued.token}x`, secret, expected, 1_010_000), false);
});
