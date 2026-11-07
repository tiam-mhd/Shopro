import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { MAX_SALES_OCR_IMAGE_BYTES, SalesOcrService } from "../dist/sales/sales-ocr.service.js";

const user = { id: "user-1", sessionId: "session-1", businessId: "business-1", branchId: "branch-1", role: "OWNER" };
const request = { requestId: "ocr-test" };
const prisma = { business: { findUnique: async () => null } };

test("local invoice OCR rejects invalid, missing, and oversized image input before database access", async () => {
  const service = new SalesOcrService(prisma);
  await assert.rejects(service.analyze(user, undefined, request), BadRequestException);
  await assert.rejects(service.analyze(user, { buffer: Buffer.from("not an image") }, request), BadRequestException);
  await assert.rejects(service.analyze(user, { buffer: Buffer.alloc(MAX_SALES_OCR_IMAGE_BYTES + 1) }, request), BadRequestException);
  await service.onModuleDestroy();
});

test("local invoice OCR keeps authorization checks ahead of image processing", async () => {
  const service = new SalesOcrService(prisma);
  await assert.rejects(service.analyze({ ...user, role: "VIEWER" }, undefined, request), ForbiddenException);
  await service.onModuleDestroy();
});
