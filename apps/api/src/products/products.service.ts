import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import type { CreateProductCategoryDto, CreateProductDto, UpdateProductDto, UpdateUnitsVisibilityDto } from "./products.dto.js";
import type { UpdateCatalogCategoryDto } from "./services.dto.js";
import { UNIT_GROUPS, unitGroupLabel } from "./unit-catalog.js";
import { assertUuid } from "../common/uuid-param.pipe.js";
import { AccountingService } from "../finance/accounting.service.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { prepareProductImage } from "./product-image-files.js";

const parseMoney = (value: string) => { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); return BigInt(value); };
const quantityText = (milli: bigint) => {
  const sign = milli < 0n ? "-" : "";
  const absolute = milli < 0n ? -milli : milli;
  return `${sign}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, "0")}`;
};
const roundDivide = (numerator: bigint, denominator: bigint) => numerator >= 0n ? (numerator + denominator / 2n) / denominator : -((-numerator + denominator / 2n) / denominator);

function parseInitialQuantity(value: string, precision: number) {
  const normalized = toAsciiDigits(value).replace(/٫/g, ".").replace(/[٬,\s]/g, "").trim();
  const match = /^(\d{1,15})(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match || (match[2]?.length ?? 0) > precision) throw new BadRequestException(`مقدار موجودی باید نامنفی و حداکثر ${precision} رقم اعشار داشته باشد.`);
  return BigInt(match[1]) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

const productImagePath = (productId: string, imageId: string) => `/products/${productId}/images/${imageId}`;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService, private readonly storage: AttachmentStorageService) {}

  async list(user: AuthenticatedUser, search?: string, onlyLow?: string, cursor?: string, requestedLimit?: string, kind?: string) {
    const { businessId, branchId } = this.scope(user);
    if (kind !== undefined && kind !== "STOCK") throw new BadRequestException("برای فهرست خدمات از مسیر اختصاصی خدمات استفاده کنید.");
    assertUuid(cursor, "نشانگر صفحه برای فهرست کالا معتبر نیست.");
    const q = search ? normalizePersianSearch(search) : undefined;
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    if (pageMode && onlyLow === "true") throw new BadRequestException("فیلتر موجودی کم با صفحه‌بندی این فهرست سازگار نیست؛ از گزارش موجودی استفاده کنید.");
    const limit = pageMode ? pageLimit(requestedLimit) : 200;
    const where = { businessId, branchId, catalogItem: { isActive: true, ...(q ? { OR: [{ normalizedName: { contains: q } }, { name: { contains: search!.trim(), mode: "insensitive" as const } }] } : {}) }, ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" as const } }, { barcode: { contains: q } }] } : {}) };
    if (cursor && !(await this.prisma.product.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای فهرست کالا معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.product.findMany({
      where,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { catalogItem: { include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } } } }, category: { select: { id: true, name: true } }, balances: { where: { branchId: user.branchId ?? "" }, select: { quantityOnHand: true } }, images: { where: { branchId: user.branchId ?? "" }, orderBy: { position: "asc" }, select: { id: true, position: true } } },
      orderBy: [{ catalogItem: { normalizedName: "asc" } }, { id: "asc" }], take: limit + (pageMode ? 1 : 0),
    });
    const mapped = rows.map((row) => ({ id: row.id, name: row.catalogItem.name, sku: row.sku, barcode: row.barcode, kind: "STOCK" as const, unit: row.catalogItem.unit, category: row.category, salePriceRial: row.catalogItem.salePriceRial.toString(), defaultCostRial: row.defaultCostRial?.toString() ?? null, reorderPoint: row.reorderPoint?.toString() ?? null, taxRateBasisPoints: row.catalogItem.taxRateBasisPoints, trackInventory: row.trackInventory, quantityOnHand: row.balances[0]?.quantityOnHand.toString() ?? "0", images: row.images.map((image) => ({ id: image.id, position: image.position, path: productImagePath(row.id, image.id) })) }));
    const filtered = onlyLow === "true" ? mapped.filter((row) => row.reorderPoint !== null && Number(row.quantityOnHand) <= Number(row.reorderPoint)) : mapped;
    return pageMode ? cursorPage(filtered, limit, (row) => row.id) : filtered;
  }

  async get(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const row = await this.prisma.product.findFirst({ where: { id, businessId, branchId }, include: { catalogItem: { include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } } } }, category: { select: { id: true, name: true } }, balances: { where: { branchId }, select: { quantityOnHand: true, averageCostRial: true, inventoryValueRial: true } }, images: { where: { branchId }, orderBy: { position: "asc" }, select: { id: true, position: true } } } });
    if (!row) throw new NotFoundException("کالا پیدا نشد.");
    return { id: row.id, name: row.catalogItem.name, sku: row.sku, barcode: row.barcode, kind: "STOCK", unit: row.catalogItem.unit, category: row.category, salePriceRial: row.catalogItem.salePriceRial.toString(), defaultCostRial: row.defaultCostRial?.toString() ?? null, taxRateBasisPoints: row.catalogItem.taxRateBasisPoints, trackInventory: row.trackInventory, isActive: row.catalogItem.isActive, reorderPoint: row.reorderPoint?.toString() ?? null, quantityOnHand: row.balances[0]?.quantityOnHand.toString() ?? "0", averageCostRial: row.balances[0]?.averageCostRial.toString() ?? null, inventoryValueRial: row.balances[0]?.inventoryValueRial.toString() ?? null, images: row.images.map((image) => ({ id: image.id, position: image.position, path: productImagePath(row.id, image.id) })) };
  }

  async create(user: AuthenticatedUser, dto: CreateProductDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    let unit = dto.unitId ? await this.prisma.unit.findFirst({ where: { id: dto.unitId, businessId, isVisible: true } }) : null;
    if (!dto.unitId) {
      const visibleUnits = await this.prisma.unit.findMany({ where: { businessId, isVisible: true }, select: { id: true }, take: 2 });
      if (visibleUnits.length === 1) unit = await this.prisma.unit.findUnique({ where: { id_businessId: { id: visibleUnits[0].id, businessId } } });
      else if (visibleUnits.length === 0) throw new BadRequestException("ابتدا دست‌کم یک واحد را برای نمایش فعال کنید.");
      else throw new BadRequestException("واحد کالا را انتخاب کنید.");
    }
    if (!unit) throw new BadRequestException("واحد انتخاب‌شده معتبر یا برای نمایش فعال نیست.");
    if (dto.categoryId && !(await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, businessId, branchId, isActive: true } }))) throw new BadRequestException("دسته‌بندی انتخاب‌شده معتبر نیست.");
    const initialQuantityMilli = dto.initialQuantity === undefined ? 0n : parseInitialQuantity(dto.initialQuantity, unit.precision);
    if (dto.kind && dto.kind !== "STOCK") throw new BadRequestException("برای ثبت خدمت از مسیر اختصاصی خدمات استفاده کنید.");
    if (initialQuantityMilli > 0n && !branchId) throw new BadRequestException("برای ثبت موجودی اولیه، ابتدا یک شعبه را انتخاب کنید.");
    if (initialQuantityMilli > 0n) {
      const businessSettings = await this.prisma.business.findUnique({ where: { id: businessId }, select: { inventoryEnabled: true } });
      if (!businessSettings?.inventoryEnabled) throw new BadRequestException("مدیریت موجودی برای این کسب‌وکار فعال نیست.");
    }
    const name = dto.name.trim();
    const defaultCostRial = dto.defaultCostRial ? parseMoney(dto.defaultCostRial) : null;
    return this.prisma.$transaction(async (tx) => {
      const catalogItem = await tx.catalogItem.create({ data: { businessId, branchId, name, normalizedName: normalizePersianSearch(name), kind: "STOCK", unitId: unit.id, salePriceRial: parseMoney(dto.salePriceRial), taxRateBasisPoints: dto.taxRateBasisPoints ?? 0 } });
      const product = await tx.product.create({ data: { id: catalogItem.id, businessId, branchId, sku: dto.sku?.trim() || null, barcode: dto.barcode?.trim() || null, categoryId: dto.categoryId || null, defaultCostRial, reorderPoint: dto.reorderPoint ?? null, trackInventory: true } });
      let openingValueRial = 0n;
      if (initialQuantityMilli > 0n && branchId) {
        const unitCostRial = defaultCostRial ?? 0n;
        openingValueRial = (initialQuantityMilli * unitCostRial + 500n) / 1000n;
        const quantity = quantityText(initialQuantityMilli);
        const openingDate = new Date();
        openingDate.setUTCHours(0, 0, 0, 0);
        await this.accounting.assertOpen(tx, businessId, openingDate);
        await tx.inventoryBalance.create({ data: { businessId, branchId, productId: product.id, quantityOnHand: new Prisma.Decimal(quantity), inventoryValueRial: openingValueRial, averageCostRial: unitCostRial } });
        await tx.inventoryMovement.create({ data: { businessId, branchId, productId: product.id, txnDate: openingDate, sourceType: "PRODUCT_OPENING", sourceId: product.id, quantityDelta: new Prisma.Decimal(quantity), unitCostRial, valueDeltaRial: openingValueRial, createdBy: user.id } });
        if (openingValueRial > 0n) {
          const inventoryAccountId = await this.accounting.account(tx, businessId, "inventory");
          const equityAccountId = await this.accounting.account(tx, businessId, "equity");
        await this.accounting.createJournal(tx, { businessId, branchId, date: openingDate, sourceType: "PRODUCT_OPENING", sourceId: product.id, memo: `موجودی اولیهٔ ${catalogItem.name}`, actorId: user.id, lines: [
            { ledgerAccountId: inventoryAccountId, debitRial: openingValueRial, description: `موجودی اولیهٔ ${catalogItem.name}` },
            { ledgerAccountId: equityAccountId, creditRial: openingValueRial, description: "سرمایهٔ افتتاحیهٔ موجودی کالا" },
          ] });
        }
      }
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "product.created", entityType: "product", entityId: product.id, requestId: request.requestId ?? "unknown", afterJson: { name: catalogItem.name, sku: product.sku, salePriceRial: catalogItem.salePriceRial.toString(), initialQuantity: quantityText(initialQuantityMilli), openingValueRial: openingValueRial.toString() } } });
      return this.serialize({ ...catalogItem, ...product });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateProductDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const before = await this.prisma.product.findFirst({ where: { id, businessId, branchId }, include: { catalogItem: true } });
    if (!before || before.catalogItem.archivedAt !== null) throw new NotFoundException("کالا پیدا نشد.");
    if (dto.unitId && dto.unitId !== before.catalogItem.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, businessId, isVisible: true }, select: { id: true } });
      if (!unit) throw new BadRequestException("واحد انتخاب‌شده متعلق به این کسب‌وکار نیست.");
      const hasMovements = await this.prisma.inventoryMovement.count({ where: { businessId, branchId, productId: id } });
      const hasCounts = await this.prisma.stockCountLine.count({ where: { businessId, branchId, productId: id } });
      if (hasMovements > 0 || hasCounts > 0) throw new BadRequestException("واحد کالایی که گردش یا شمارش موجودی دارد قابل تغییر نیست.");
    }
    let targetQuantityMilli: bigint | undefined;
    let quantityBranchId: string | undefined;
    if (dto.currentQuantity !== undefined) {
      if (!before.trackInventory) throw new BadRequestException("برای این کالا مدیریت موجودی فعال نیست.");
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId ?? before.catalogItem.unitId, businessId }, select: { precision: true } });
      if (!unit) throw new BadRequestException("واحد کالا برای ثبت موجودی معتبر نیست.");
      targetQuantityMilli = parseInitialQuantity(dto.currentQuantity, unit.precision);
      quantityBranchId = user.branchId;
      if (!quantityBranchId) throw new BadRequestException("برای اصلاح موجودی، ابتدا یک شعبه را انتخاب کنید.");
      const businessSettings = await this.prisma.business.findUnique({ where: { id: businessId }, select: { inventoryEnabled: true } });
      if (!businessSettings?.inventoryEnabled) throw new BadRequestException("مدیریت موجودی برای این کسب‌وکار فعال نیست.");
    }
    if (dto.categoryId && !(await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, businessId, branchId, isActive: true }, select: { id: true } }))) throw new BadRequestException("دسته‌بندی انتخاب‌شده در این شعبه در دسترس نیست.");
    const product = await this.prisma.$transaction(async (tx) => {
      const catalogItem = await tx.catalogItem.update({ where: { id }, data: { name: dto.name?.trim(), normalizedName: dto.name ? normalizePersianSearch(dto.name) : undefined, unitId: dto.unitId, salePriceRial: dto.salePriceRial ? parseMoney(dto.salePriceRial) : undefined, taxRateBasisPoints: dto.taxRateBasisPoints, isActive: dto.isActive, archivedAt: dto.isActive === false ? new Date() : dto.isActive === true ? null : undefined } });
      const updated = await tx.product.update({ where: { id }, data: { sku: dto.sku === undefined ? undefined : dto.sku?.trim() || null, barcode: dto.barcode === undefined ? undefined : dto.barcode?.trim() || null, categoryId: dto.categoryId === undefined ? undefined : dto.categoryId || null, defaultCostRial: dto.defaultCostRial === undefined ? undefined : dto.defaultCostRial ? parseMoney(dto.defaultCostRial) : null, reorderPoint: dto.reorderPoint === undefined ? undefined : dto.reorderPoint || null } });
      if (targetQuantityMilli !== undefined && quantityBranchId) await this.adjustCurrentQuantity(tx, user, { ...updated, name: catalogItem.name, kind: catalogItem.kind }, quantityBranchId, targetQuantityMilli, request);
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: dto.salePriceRial !== undefined ? "product.price.updated" : "product.updated", entityType: "product", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.catalogItem.name, salePriceRial: before.catalogItem.salePriceRial.toString(), isActive: before.catalogItem.isActive }, afterJson: { name: catalogItem.name, salePriceRial: catalogItem.salePriceRial.toString(), isActive: catalogItem.isActive } } });
      return this.serialize({ ...catalogItem, ...updated });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
    return product;
  }

  private async adjustCurrentQuantity(tx: Prisma.TransactionClient, user: AuthenticatedUser, product: { id: string; name: string; defaultCostRial: bigint | null; kind: string; trackInventory: boolean }, branchId: string, countedMilli: bigint, request: AppRequest) {
    if (product.kind !== "STOCK" || !product.trackInventory) throw new BadRequestException("برای خدمت نمی‌توان موجودی انبار ثبت کرد.");
    const businessId = this.business(user);
    const balance = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId: product.id } } });
    const currentMilli = balance ? parseInitialQuantity(balance.quantityOnHand.toString(), 3) : 0n;
    if (currentMilli === countedMilli) return;
    const deltaMilli = countedMilli - currentMilli;
    const unitCostRial = balance?.averageCostRial ?? product.defaultCostRial ?? 0n;
    const valueDeltaRial = countedMilli === 0n && balance ? -balance.inventoryValueRial : roundDivide(deltaMilli * unitCostRial, 1000n);
    const nextValueRial = (balance?.inventoryValueRial ?? 0n) + valueDeltaRial;
    if (nextValueRial < 0n) throw new BadRequestException("ارزش موجودی پس از اصلاح نمی‌تواند منفی شود.");
    const averageCostRial = countedMilli > 0n ? roundDivide(nextValueRial * 1000n, countedMilli) : 0n;
    const txnDate = new Date();
    txnDate.setUTCHours(0, 0, 0, 0);
    await this.accounting.assertOpen(tx, businessId, txnDate);
    const count = await tx.stockCount.create({ data: {
      businessId, branchId, txnDate, reason: `اصلاح موجودی از فرم کالا: ${product.name}`, createdBy: user.id,
      lines: { create: { productId: product.id, countedQuantity: new Prisma.Decimal(quantityText(countedMilli)), systemQuantitySnapshot: new Prisma.Decimal(quantityText(currentMilli)), deltaQuantity: new Prisma.Decimal(quantityText(deltaMilli)) } },
    } });
    await tx.inventoryBalance.upsert({
      where: { businessId_branchId_productId: { businessId, branchId, productId: product.id } },
      create: { businessId, branchId, productId: product.id, quantityOnHand: new Prisma.Decimal(quantityText(countedMilli)), inventoryValueRial: nextValueRial, averageCostRial },
      update: { quantityOnHand: new Prisma.Decimal(quantityText(countedMilli)), inventoryValueRial: nextValueRial, averageCostRial },
    });
    await tx.inventoryMovement.create({ data: { businessId, branchId, productId: product.id, txnDate, sourceType: "STOCK_COUNT", sourceId: count.id, quantityDelta: new Prisma.Decimal(quantityText(deltaMilli)), unitCostRial, valueDeltaRial, createdBy: user.id } });
    if (valueDeltaRial !== 0n) {
      const inventoryAccountId = await this.accounting.account(tx, businessId, "inventory");
      const journalLines = valueDeltaRial > 0n
        ? [{ ledgerAccountId: inventoryAccountId, debitRial: valueDeltaRial, description: `افزایش موجودی ${product.name}` }, { ledgerAccountId: await this.accounting.account(tx, businessId, "other_income"), creditRial: valueDeltaRial, description: "افزایش ناشی از شمارش" }]
        : [{ ledgerAccountId: await this.accounting.account(tx, businessId, "general_expense"), debitRial: -valueDeltaRial, description: `کسری موجودی ${product.name}` }, { ledgerAccountId: inventoryAccountId, creditRial: -valueDeltaRial, description: "کاهش موجودی شمارش‌شده" }];
      await this.accounting.createJournal(tx, { businessId, branchId, date: txnDate, sourceType: "STOCK_COUNT", sourceId: count.id, memo: count.reason, actorId: user.id, lines: journalLines });
    }
    await tx.stockCount.update({ where: { id: count.id }, data: { status: "POSTED" } });
    await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "product.stock.quantity.adjusted", entityType: "product", entityId: product.id, requestId: request.requestId ?? "unknown", beforeJson: { quantity: quantityText(currentMilli) }, afterJson: { quantity: quantityText(countedMilli), movementId: count.id, valueDeltaRial: valueDeltaRial.toString() } } });
  }

  async uploadImage(user: AuthenticatedUser, productId: string, placement: string | undefined, file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    if (placement !== "PRIMARY" && placement !== "GALLERY") throw new BadRequestException("نوع جایگاه تصویر معتبر نیست.");
    const product = await this.prisma.product.findFirst({ where: { id: productId, businessId, branchId }, include: { catalogItem: { select: { archivedAt: true, name: true } } } });
    if (!product || product.catalogItem.archivedAt) throw new NotFoundException("کالا پیدا نشد.");
    const prepared = await prepareProductImage(file);
    const imageId = randomUUID();
    const storageScope = { businessId, branchId, productId, imageId };
    await this.storage.saveProductImage(storageScope, prepared.bytes);
    let previousPrimaryId: string | null = null;
    let previousPrimaryStorageProductId: string | null = null;
    try {
      const image = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.productImage.findMany({ where: { businessId, branchId, productId }, orderBy: { position: "asc" }, select: { id: true, position: true, storageProductId: true } });
        let position: number;
        if (placement === "PRIMARY") {
          const previousPrimary = existing.find((row) => row.position === 0);
          previousPrimaryId = previousPrimary?.id ?? null;
          if (previousPrimary) previousPrimaryStorageProductId = previousPrimary.storageProductId;
          if (previousPrimaryId) await tx.productImage.delete({ where: { id: previousPrimaryId } });
          position = 0;
        } else {
          const galleryCount = existing.filter((row) => row.position > 0).length;
          if (galleryCount >= 8) throw new BadRequestException("گالری هر کالا حداکثر ۸ تصویر دارد.");
          position = Math.max(0, ...existing.map((row) => row.position)) + 1;
        }
        const created = await tx.productImage.create({ data: { id: imageId, businessId, branchId, productId, storageProductId: productId, position, bytes: BigInt(prepared.bytes.byteLength), checksum: prepared.checksum } });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: placement === "PRIMARY" ? "product.image.primary.updated" : "product.image.gallery.added", entityType: "product_image", entityId: imageId, requestId: request.requestId ?? "unknown", afterJson: { productId, position, bytes: prepared.bytes.byteLength, checksum: prepared.checksum } } });
        return created;
      }, { isolationLevel: "Serializable" });
      if (previousPrimaryId) await this.storage.removeProductImage({ businessId, branchId, productId: previousPrimaryStorageProductId ?? productId, imageId: previousPrimaryId }).catch(() => undefined);
      return { id: image.id, position: image.position, path: productImagePath(productId, image.id) };
    } catch (error) {
      await this.storage.removeProductImage(storageScope).catch(() => undefined);
      throw error;
    }
  }

  async transfer(user: AuthenticatedUser, productId: string, targetBranchId: string, request: AppRequest) {
    const { businessId, branchId: sourceBranchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    assertUuid(targetBranchId, "شناسهٔ شعبهٔ مقصد معتبر نیست.");
    if (targetBranchId === sourceBranchId) throw new BadRequestException("شعبهٔ مقصد باید با شعبهٔ جاری متفاوت باشد.");
    if (!user.branchIds?.includes(targetBranchId)) throw new ForbiddenException("به شعبهٔ مقصد دسترسی ندارید.");
    const targetBranch = await this.prisma.branch.findFirst({ where: { id: targetBranchId, businessId, isActive: true }, select: { id: true } });
    if (!targetBranch) throw new BadRequestException("شعبهٔ مقصد فعال و در دسترس نیست.");
    const source = await this.prisma.product.findFirst({
      where: { id: productId, businessId, branchId: sourceBranchId },
      include: { catalogItem: true, images: { where: { branchId: sourceBranchId }, orderBy: { position: "asc" } } },
    });
    if (!source) throw new NotFoundException("کالا در شعبهٔ جاری پیدا نشد.");
    const prior = await this.prisma.catalogItem.findFirst({ where: { businessId, branchId: targetBranchId, originBranchId: sourceBranchId, originItemId: productId }, select: { id: true } });
    if (prior) return { id: prior.id, sourceId: productId, branchId: targetBranchId, alreadyTransferred: true };

    const destinationProductId = randomUUID();
    const savedFiles: Array<{ businessId: string; branchId: string; productId: string; imageId: string }> = [];
    const imageCopies: Array<{ id: string; position: number; bytes: bigint; checksum: string }> = [];
    try {
      for (const image of source.images) {
        const bytes = await this.storage.readProductImage({ businessId, branchId: sourceBranchId, productId: image.storageProductId, imageId: image.id });
        const imageId = randomUUID();
        const targetScope = { businessId, branchId: targetBranchId, productId: destinationProductId, imageId };
        await this.storage.saveProductImage(targetScope, bytes);
        savedFiles.push(targetScope);
        imageCopies.push({ id: imageId, position: image.position, bytes: image.bytes, checksum: image.checksum });
      }

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`catalog-transfer:${businessId}:${sourceBranchId}:${targetBranchId}:${productId}`}, 0))`;
        const existing = await tx.catalogItem.findFirst({ where: { businessId, branchId: targetBranchId, originBranchId: sourceBranchId, originItemId: productId }, select: { id: true } });
        if (existing) return { id: existing.id, created: false };
        const identifiers = [
          ...(source.sku ? [{ sku: source.sku }] : []),
          ...(source.barcode ? [{ barcode: source.barcode }] : []),
        ];
        if (identifiers.length && await tx.product.findFirst({ where: { businessId, branchId: targetBranchId, OR: identifiers }, select: { id: true } })) {
          throw new BadRequestException("کد کالا یا بارکد این کالا در شعبهٔ مقصد قبلاً استفاده شده است؛ ابتدا شناسهٔ تکراری را در مبدأ یا مقصد تغییر دهید.");
        }
        const categoryId = source.categoryId ? await this.copyProductCategory(tx, businessId, sourceBranchId, targetBranchId, source.categoryId) : null;
        const catalogItem = await tx.catalogItem.create({ data: {
          id: destinationProductId, businessId, branchId: targetBranchId, originBranchId: sourceBranchId, originItemId: productId,
          name: source.catalogItem.name, normalizedName: source.catalogItem.normalizedName, kind: "STOCK", unitId: source.catalogItem.unitId,
          salePriceRial: source.catalogItem.salePriceRial, taxRateBasisPoints: source.catalogItem.taxRateBasisPoints,
          isActive: source.catalogItem.isActive, archivedAt: source.catalogItem.archivedAt,
        } });
        await tx.product.create({ data: {
          id: catalogItem.id, businessId, branchId: targetBranchId, sku: source.sku, barcode: source.barcode, categoryId,
          defaultCostRial: source.defaultCostRial, reorderPoint: source.reorderPoint, trackInventory: source.trackInventory,
        } });
        if (imageCopies.length) await tx.productImage.createMany({ data: imageCopies.map((image) => ({ ...image, businessId, branchId: targetBranchId, productId: destinationProductId, storageProductId: destinationProductId })) });
        await tx.auditEvent.create({ data: {
          businessId, actorId: user.id, action: "product.transferred", entityType: "product", entityId: destinationProductId,
          requestId: request.requestId ?? "unknown", beforeJson: { sourceProductId: productId, sourceBranchId },
          afterJson: { productId: destinationProductId, branchId: targetBranchId, imageCount: imageCopies.length, inventoryCopied: false, historyCopied: false },
        } });
        return { id: destinationProductId, created: true };
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
      if (!result.created) {
        await Promise.all(savedFiles.map((scope) => this.storage.removeProductImage(scope).catch(() => undefined)));
        return { id: result.id, sourceId: productId, branchId: targetBranchId, alreadyTransferred: true };
      }
      return { id: result.id, sourceId: productId, branchId: targetBranchId, alreadyTransferred: false, imageCount: imageCopies.length };
    } catch (error) {
      await Promise.all(savedFiles.map((scope) => this.storage.removeProductImage(scope).catch(() => undefined)));
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await this.prisma.catalogItem.findFirst({ where: { businessId, branchId: targetBranchId, originBranchId: sourceBranchId, originItemId: productId }, select: { id: true } });
        if (concurrent) return { id: concurrent.id, sourceId: productId, branchId: targetBranchId, alreadyTransferred: true };
        throw new BadRequestException("کد کالا یا بارکد در شعبهٔ مقصد تکراری است.");
      }
      throw error;
    }
  }

  async setPrimaryImage(user: AuthenticatedUser, productId: string, imageId: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    await this.prisma.$transaction(async (tx) => {
      const images = await tx.productImage.findMany({ where: { businessId, branchId, productId }, orderBy: { position: "asc" }, select: { id: true } });
      if (!images.some((image) => image.id === imageId)) throw new NotFoundException("تصویر کالا پیدا نشد.");
      const reordered = [images.find((image) => image.id === imageId)!, ...images.filter((image) => image.id !== imageId)];
      for (let index = 0; index < reordered.length; index++) await tx.productImage.update({ where: { id: reordered[index].id }, data: { position: -(index + 1) } });
      for (let index = 0; index < reordered.length; index++) await tx.productImage.update({ where: { id: reordered[index].id }, data: { position: index } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "product.image.primary.selected", entityType: "product_image", entityId: imageId, requestId: request.requestId ?? "unknown", afterJson: { productId, imageId } } });
    }, { isolationLevel: "Serializable" });
    return { id: imageId, position: 0, path: productImagePath(productId, imageId) };
  }

  async deleteImage(user: AuthenticatedUser, productId: string, imageId: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const image = await this.prisma.$transaction(async (tx) => {
      const target = await tx.productImage.findFirst({ where: { id: imageId, businessId, branchId, productId } });
      if (!target) throw new NotFoundException("تصویر کالا پیدا نشد.");
      await tx.productImage.delete({ where: { id: imageId } });
      const remaining = await tx.productImage.findMany({ where: { businessId, branchId, productId }, orderBy: { position: "asc" }, select: { id: true } });
      for (let index = 0; index < remaining.length; index++) await tx.productImage.update({ where: { id: remaining[index].id }, data: { position: -(index + 1) } });
      for (let index = 0; index < remaining.length; index++) await tx.productImage.update({ where: { id: remaining[index].id }, data: { position: index } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "product.image.deleted", entityType: "product_image", entityId: imageId, requestId: request.requestId ?? "unknown", beforeJson: { productId, position: target.position, checksum: target.checksum } } });
      return target;
    }, { isolationLevel: "Serializable" });
    await this.storage.removeProductImage({ businessId, branchId, productId: image.storageProductId, imageId }).catch(() => undefined);
    return { id: image.id, deleted: true };
  }

  async readImage(user: AuthenticatedUser, productId: string, imageId: string) {
    const { businessId, branchId } = this.scope(user);
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId, businessId, branchId }, select: { id: true, storageProductId: true } });
    if (!image) throw new NotFoundException("تصویر کالا پیدا نشد.");
    return this.storage.readProductImage({ businessId, branchId, productId: image.storageProductId, imageId });
  }

  async units(user: AuthenticatedUser) {
    const businessId = this.business(user);
    return this.prisma.unit.findMany({ where: { businessId, isVisible: true }, select: { id: true, code: true, labelFa: true, precision: true, groupKey: true }, orderBy: [{ groupKey: "asc" }, { labelFa: "asc" }] });
  }

  async unitSettings(user: AuthenticatedUser) {
    const businessId = this.business(user);
    const units = await this.prisma.unit.findMany({ where: { businessId }, select: { id: true, code: true, labelFa: true, precision: true, groupKey: true, isVisible: true }, orderBy: [{ groupKey: "asc" }, { labelFa: "asc" }] });
    return {
      units: units.map((unit) => ({ ...unit, groupLabel: unitGroupLabel(unit.groupKey) })),
      groups: UNIT_GROUPS.map((group) => ({ ...group, units: units.filter((unit) => unit.groupKey === group.key).map(({ id, code, labelFa, precision, isVisible }) => ({ id, code, labelFa, precision, isVisible })) })),
      visibleCount: units.filter((unit) => unit.isVisible).length,
    };
  }

  async updateUnitSettings(user: AuthenticatedUser, dto: UpdateUnitsVisibilityDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const visibleIds = [...new Set(dto.visibleUnitIds)];
    if (!visibleIds.length) throw new BadRequestException("برای ثبت کالا، دست‌کم یک واحد باید در فهرست نمایش بماند.");
    await this.prisma.$transaction(async (tx) => {
      const units = await tx.unit.findMany({ where: { businessId }, select: { id: true, isVisible: true } });
      if (visibleIds.some((id) => !units.some((unit) => unit.id === id))) throw new BadRequestException("فهرست واحدها معتبر نیست.");
      const previousVisible = units.filter((unit) => unit.isVisible).length;
      const unchanged = units.length === visibleIds.length && units.every((unit) => visibleIds.includes(unit.id) === unit.isVisible);
      if (unchanged) return;
      await tx.unit.updateMany({ where: { businessId }, data: { isVisible: false } });
      await tx.unit.updateMany({ where: { businessId, id: { in: visibleIds } }, data: { isVisible: true } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "unit.visibility.updated", entityType: "business_unit_settings", entityId: businessId, requestId: request.requestId ?? "unknown", beforeJson: { visibleCount: previousVisible }, afterJson: { visibleCount: visibleIds.length, visibleUnitIds: visibleIds } } });
    });
    return this.unitSettings(user);
  }

  async categories(user: AuthenticatedUser, includeArchived = false) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.productCategory.findMany({ where: { businessId, branchId, ...(includeArchived ? {} : { isActive: true }) }, include: { _count: { select: { products: true } }, parent: { select: { name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
    return rows.map(({ id, name, parentId, parent, isActive, _count }) => ({ id, name, parentId, parentName: parent?.name ?? null, isActive, productCount: _count.products }));
  }

  async createCategory(user: AuthenticatedUser, dto: CreateProductCategoryDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const name = dto.name.trim();
    const duplicate = await this.prisma.productCategory.findFirst({ where: { businessId, branchId, name: { equals: name, mode: "insensitive" }, isActive: true }, select: { id: true } });
    if (duplicate) throw new BadRequestException("دسته‌ای با این نام از قبل وجود دارد.");
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productCategory.create({ data: { businessId, branchId, name } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "product_category.created", entityType: "product_category", entityId: created.id, requestId: request.requestId ?? "unknown", afterJson: { name } } });
      return created;
    });
    return { id: category.id, name: category.name };
  }

  async updateCategory(user: AuthenticatedUser, id: string, dto: UpdateCatalogCategoryDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const before = await this.prisma.productCategory.findFirst({ where: { id, businessId, branchId } });
    if (!before) throw new NotFoundException("دسته‌بندی کالا پیدا نشد.");
    if (dto.parentId === id) throw new BadRequestException("دسته‌بندی نمی‌تواند والد خودش باشد.");
    if (dto.parentId && !(await this.prisma.productCategory.findFirst({ where: { id: dto.parentId, businessId, branchId, isActive: true } }))) throw new BadRequestException("دسته‌بندی والد در این شعبه در دسترس نیست.");
    if (dto.isActive === false && await this.prisma.productCategory.count({ where: { businessId, branchId, parentId: id, isActive: true } })) throw new BadRequestException("ابتدا دسته‌های زیرمجموعه را بایگانی کنید.");
    const name = dto.name?.trim();
    if (name && await this.prisma.productCategory.findFirst({ where: { businessId, branchId, id: { not: id }, name: { equals: name, mode: "insensitive" } } })) throw new BadRequestException("دسته‌بندی کالایی با این نام از قبل وجود دارد.");
    const category = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.productCategory.update({ where: { id }, data: { name, parentId: dto.parentId === undefined ? undefined : dto.parentId || null, isActive: dto.isActive } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: dto.isActive === false ? "product_category.archived" : "product_category.updated", entityType: "product_category", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.name, isActive: before.isActive, parentId: before.parentId }, afterJson: { name: updated.name, isActive: updated.isActive, parentId: updated.parentId } } });
      return updated;
    });
    return { id: category.id, name: category.name, parentId: category.parentId, isActive: category.isActive };
  }

  private serialize(product: { id: string; name: string; sku: string | null; barcode: string | null; kind: string; salePriceRial: bigint; defaultCostRial: bigint | null; taxRateBasisPoints: number; trackInventory: boolean }) { return { id: product.id, name: product.name, sku: product.sku, barcode: product.barcode, kind: product.kind, salePriceRial: product.salePriceRial.toString(), defaultCostRial: product.defaultCostRial?.toString() ?? null, taxRateBasisPoints: product.taxRateBasisPoints, trackInventory: product.trackInventory }; }
  private async copyProductCategory(tx: Prisma.TransactionClient, businessId: string, sourceBranchId: string, targetBranchId: string, categoryId: string) {
    const chain: Array<{ id: string; parentId: string | null; name: string; isActive: boolean }> = [];
    const seen = new Set<string>();
    let currentId: string | null = categoryId;
    while (currentId) {
      if (seen.has(currentId)) throw new BadRequestException("ساختار دسته‌بندی کالا معتبر نیست.");
      seen.add(currentId);
      const current: { id: string; parentId: string | null; name: string; isActive: boolean } | null = await tx.productCategory.findFirst({ where: { id: currentId, businessId, branchId: sourceBranchId }, select: { id: true, parentId: true, name: true, isActive: true } });
      if (!current) throw new NotFoundException("دسته‌بندی کالای مبدأ پیدا نشد.");
      chain.unshift(current);
      currentId = current.parentId;
    }
    let targetParentId: string | null = null;
    for (const category of chain) {
      let target: { id: string } | null = await tx.productCategory.findFirst({ where: { businessId, branchId: targetBranchId, parentId: targetParentId, name: { equals: category.name, mode: "insensitive" } }, select: { id: true } });
      if (!target) target = await tx.productCategory.create({ data: { businessId, branchId: targetBranchId, parentId: targetParentId, name: category.name, isActive: category.isActive }, select: { id: true } });
      targetParentId = target.id;
    }
    return targetParentId;
  }
  private business(user: AuthenticatedUser) { if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید."); return user.businessId; }
  private scope(user: AuthenticatedUser) { const businessId = this.business(user); if (!user.branchId) throw new BadRequestException("ابتدا یک شعبه را انتخاب کنید."); return { businessId, branchId: user.branchId }; }
  private requireRole(user: AuthenticatedUser, allowed: string[]) { if (!allowed.includes(user.role ?? "")) throw new ForbiddenException(); }
}
