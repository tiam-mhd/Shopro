import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { normalizePersianSearch } from "@shopro/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { assertUuid } from "../common/uuid-param.pipe.js";
import type { CreateProductCategoryDto } from "./products.dto.js";
import type { CreateServiceDto, UpdateCatalogCategoryDto, UpdateServiceDto } from "./services.dto.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { prepareProductImage } from "./product-image-files.js";

const imagePath = (serviceId: string, imageId: string) => `/services/${serviceId}/images/${imageId}`;

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: AttachmentStorageService) {}

  async catalog(user: AuthenticatedUser, search?: string, cursor?: string, requestedLimit?: string) {
    const businessId = this.business(user);
    assertUuid(cursor, "نشانگر صفحهٔ فهرست کالا و خدمات معتبر نیست.");
    const q = search ? normalizePersianSearch(search) : undefined;
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit) : 200;
    const where = { businessId, isActive: true, ...(q ? { OR: [
      { normalizedName: { contains: q } },
      { name: { contains: search!.trim(), mode: "insensitive" as const } },
      { product: { is: { sku: { contains: search!.trim(), mode: "insensitive" as const } } } },
      { product: { is: { barcode: { contains: search!.trim() } } } },
    ] } : {}) };
    if (cursor && !(await this.prisma.catalogItem.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحهٔ فهرست کالا و خدمات معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.catalogItem.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } }, product: { select: { sku: true, defaultCostRial: true, trackInventory: true, reorderPoint: true } } }, orderBy: [{ normalizedName: "asc" }, { id: "asc" }], take: limit + (pageMode ? 1 : 0) });
    const items = rows.map((row) => ({ id: row.id, name: row.name, sku: row.product?.sku ?? null, kind: row.kind, unit: row.unit, salePriceRial: row.salePriceRial.toString(), defaultCostRial: row.product?.defaultCostRial?.toString() ?? null, taxRateBasisPoints: row.taxRateBasisPoints, trackInventory: row.product?.trackInventory ?? false, reorderPoint: row.product?.reorderPoint?.toString() ?? null }));
    return pageMode ? cursorPage(items, limit, (row) => row.id) : items;
  }

  async catalogItem(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.catalogItem.findFirst({ where: { id, businessId: this.business(user) }, include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } }, product: { select: { sku: true, defaultCostRial: true, trackInventory: true, reorderPoint: true } }, service: { select: { description: true } } } });
    if (!row) throw new NotFoundException("کالا یا خدمت پیدا نشد.");
    return { id: row.id, name: row.name, sku: row.product?.sku ?? null, kind: row.kind, unit: row.unit, salePriceRial: row.salePriceRial.toString(), defaultCostRial: row.product?.defaultCostRial?.toString() ?? null, taxRateBasisPoints: row.taxRateBasisPoints, trackInventory: row.product?.trackInventory ?? false, reorderPoint: row.product?.reorderPoint?.toString() ?? null, description: row.service?.description ?? null };
  }

  async list(user: AuthenticatedUser, search?: string, cursor?: string, requestedLimit?: string) {
    const businessId = this.business(user);
    assertUuid(cursor, "نشانگر صفحهٔ خدمات معتبر نیست.");
    const q = search ? normalizePersianSearch(search) : undefined;
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit) : 200;
    const where: Prisma.ServiceWhereInput = { businessId, catalogItem: { isActive: true }, ...(q ? { OR: [
      { catalogItem: { is: { normalizedName: { contains: q } } } },
      { catalogItem: { is: { name: { contains: search!.trim(), mode: "insensitive" } } } },
      { description: { contains: search!.trim(), mode: "insensitive" } },
    ] } : {}) };
    if (cursor && !(await this.prisma.service.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحهٔ خدمات معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.service.findMany({
      where,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { catalogItem: { include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } } } }, category: { select: { id: true, name: true } }, images: { where: { branchId: user.branchId ?? "" }, orderBy: { position: "asc" }, select: { id: true, position: true } } },
      orderBy: [{ catalogItem: { normalizedName: "asc" } }, { id: "asc" }], take: limit + (pageMode ? 1 : 0),
    });
    const mapped = rows.map((row) => ({ id: row.id, name: row.catalogItem.name, description: row.description, unit: row.catalogItem.unit, category: row.category, salePriceRial: row.catalogItem.salePriceRial.toString(), taxRateBasisPoints: row.catalogItem.taxRateBasisPoints, images: row.images.map((image) => ({ id: image.id, position: image.position, path: imagePath(row.id, image.id) })) }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async get(user: AuthenticatedUser, id: string) {
    const businessId = this.business(user);
    const row = await this.prisma.service.findFirst({ where: { id, businessId }, include: { catalogItem: { include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } } } }, category: { select: { id: true, name: true } }, images: { where: { branchId: user.branchId ?? "" }, orderBy: { position: "asc" }, select: { id: true, position: true } } } });
    if (!row) throw new NotFoundException("خدمت پیدا نشد.");
    return { id: row.id, name: row.catalogItem.name, description: row.description, unit: row.catalogItem.unit, category: row.category, salePriceRial: row.catalogItem.salePriceRial.toString(), taxRateBasisPoints: row.catalogItem.taxRateBasisPoints, isActive: row.catalogItem.isActive, images: row.images.map((image) => ({ id: image.id, position: image.position, path: imagePath(row.id, image.id) })) };
  }

  async create(user: AuthenticatedUser, dto: CreateServiceDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireEditor(user);
    const unit = await this.resolveUnit(businessId, dto.unitId);
    if (dto.categoryId && !(await this.prisma.serviceCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true }, select: { id: true } }))) throw new BadRequestException("دسته‌بندی انتخاب‌شده در دسترس نیست.");
    const name = dto.name.trim();
    const price = this.parseMoney(dto.salePriceRial);
    const created = await this.prisma.$transaction(async (tx) => {
      const catalogItem = await tx.catalogItem.create({ data: { businessId, name, normalizedName: normalizePersianSearch(name), kind: "SERVICE", unitId: unit.id, salePriceRial: price, taxRateBasisPoints: dto.taxRateBasisPoints ?? 0 } });
      const service = await tx.service.create({ data: { id: catalogItem.id, businessId, categoryId: dto.categoryId || null, description: dto.description?.trim() || null } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "service.created", entityType: "service", entityId: service.id, requestId: request.requestId ?? "unknown", afterJson: { name, categoryId: service.categoryId, salePriceRial: price.toString() } } });
      return catalogItem;
    }, { isolationLevel: "Serializable" });
    return { id: created.id, name: created.name, salePriceRial: created.salePriceRial.toString() };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateServiceDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireEditor(user);
    const before = await this.prisma.service.findFirst({ where: { id, businessId }, include: { catalogItem: true } });
    if (!before) throw new NotFoundException("خدمت پیدا نشد.");
    if (before.catalogItem.archivedAt && dto.isActive !== true) throw new NotFoundException("خدمت پیدا نشد.");
    if (dto.unitId && dto.unitId !== before.catalogItem.unitId && await this.prisma.salesInvoiceLine.count({ where: { businessId, productId: id } })) throw new BadRequestException("واحد خدمتی که در فاکتور ثبت شده قابل تغییر نیست.");
    if (dto.unitId) await this.resolveUnit(businessId, dto.unitId);
    if (dto.categoryId && !(await this.prisma.serviceCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true }, select: { id: true } }))) throw new BadRequestException("دسته‌بندی انتخاب‌شده در دسترس نیست.");
    const name = dto.name?.trim();
    return this.prisma.$transaction(async (tx) => {
      const catalogItem = await tx.catalogItem.update({ where: { id }, data: { name, normalizedName: name ? normalizePersianSearch(name) : undefined, unitId: dto.unitId, salePriceRial: dto.salePriceRial ? this.parseMoney(dto.salePriceRial) : undefined, taxRateBasisPoints: dto.taxRateBasisPoints, isActive: dto.isActive, archivedAt: dto.isActive === false ? new Date() : dto.isActive === true ? null : undefined } });
      const service = await tx.service.update({ where: { id }, data: { categoryId: dto.categoryId === undefined ? undefined : dto.categoryId || null, description: dto.description === undefined ? undefined : dto.description?.trim() || null } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: dto.salePriceRial !== undefined ? "service.price.updated" : "service.updated", entityType: "service", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.catalogItem.name, salePriceRial: before.catalogItem.salePriceRial.toString(), isActive: before.catalogItem.isActive }, afterJson: { name: catalogItem.name, salePriceRial: catalogItem.salePriceRial.toString(), isActive: catalogItem.isActive, categoryId: service.categoryId } } });
      return { id, name: catalogItem.name, salePriceRial: catalogItem.salePriceRial.toString(), isActive: catalogItem.isActive };
    }, { isolationLevel: "Serializable" });
  }

  async uploadImage(user: AuthenticatedUser, serviceId: string, placement: string | undefined, file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireEditor(user);
    if (placement !== "PRIMARY" && placement !== "GALLERY") throw new BadRequestException("نوع جایگاه تصویر معتبر نیست.");
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, businessId }, include: { catalogItem: { select: { archivedAt: true } } } });
    if (!service || service.catalogItem.archivedAt) throw new NotFoundException("خدمت پیدا نشد.");
    const prepared = await prepareProductImage(file);
    const imageId = randomUUID();
    const storageScope = { businessId, branchId, productId: serviceId, imageId };
    await this.storage.saveProductImage(storageScope, prepared.bytes);
    let previousPrimaryId: string | null = null;
    try {
      const image = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.serviceImage.findMany({ where: { businessId, branchId, serviceId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
        let position: number;
        if (placement === "PRIMARY") {
          previousPrimaryId = existing.find((row) => row.position === 0)?.id ?? null;
          if (previousPrimaryId) await tx.serviceImage.delete({ where: { id: previousPrimaryId } });
          position = 0;
        } else {
          const galleryCount = existing.filter((row) => row.position > 0).length;
          if (galleryCount >= 8) throw new BadRequestException("گالری هر خدمت حداکثر ۸ تصویر دارد.");
          position = Math.max(0, ...existing.map((row) => row.position)) + 1;
        }
        const created = await tx.serviceImage.create({ data: { id: imageId, businessId, branchId, serviceId, position, bytes: BigInt(prepared.bytes.byteLength), checksum: prepared.checksum } });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: placement === "PRIMARY" ? "service.image.primary.updated" : "service.image.gallery.added", entityType: "service_image", entityId: imageId, requestId: request.requestId ?? "unknown", afterJson: { serviceId, position, bytes: prepared.bytes.byteLength, checksum: prepared.checksum } } });
        return created;
      }, { isolationLevel: "Serializable" });
      if (previousPrimaryId) await this.storage.removeProductImage({ businessId, branchId, productId: serviceId, imageId: previousPrimaryId }).catch(() => undefined);
      return { id: image.id, position: image.position, path: imagePath(serviceId, image.id) };
    } catch (error) {
      await this.storage.removeProductImage(storageScope).catch(() => undefined);
      throw error;
    }
  }

  async setPrimaryImage(user: AuthenticatedUser, serviceId: string, imageId: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireEditor(user);
    await this.prisma.$transaction(async (tx) => {
      const images = await tx.serviceImage.findMany({ where: { businessId, branchId, serviceId }, orderBy: { position: "asc" }, select: { id: true } });
      if (!images.some((image) => image.id === imageId)) throw new NotFoundException("تصویر خدمت پیدا نشد.");
      const reordered = [images.find((image) => image.id === imageId)!, ...images.filter((image) => image.id !== imageId)];
      for (let index = 0; index < reordered.length; index++) await tx.serviceImage.update({ where: { id: reordered[index].id }, data: { position: -(index + 1) } });
      for (let index = 0; index < reordered.length; index++) await tx.serviceImage.update({ where: { id: reordered[index].id }, data: { position: index } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "service.image.primary.selected", entityType: "service_image", entityId: imageId, requestId: request.requestId ?? "unknown", afterJson: { serviceId, imageId } } });
    }, { isolationLevel: "Serializable" });
    return { id: imageId, position: 0, path: imagePath(serviceId, imageId) };
  }

  async deleteImage(user: AuthenticatedUser, serviceId: string, imageId: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireEditor(user);
    const image = await this.prisma.$transaction(async (tx) => {
      const target = await tx.serviceImage.findFirst({ where: { id: imageId, businessId, branchId, serviceId } });
      if (!target) throw new NotFoundException("تصویر خدمت پیدا نشد.");
      await tx.serviceImage.delete({ where: { id: imageId } });
      const remaining = await tx.serviceImage.findMany({ where: { businessId, branchId, serviceId }, orderBy: { position: "asc" }, select: { id: true } });
      for (let index = 0; index < remaining.length; index++) await tx.serviceImage.update({ where: { id: remaining[index].id }, data: { position: -(index + 1) } });
      for (let index = 0; index < remaining.length; index++) await tx.serviceImage.update({ where: { id: remaining[index].id }, data: { position: index } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "service.image.deleted", entityType: "service_image", entityId: imageId, requestId: request.requestId ?? "unknown", beforeJson: { serviceId, position: target.position, checksum: target.checksum } } });
      return target;
    }, { isolationLevel: "Serializable" });
    await this.storage.removeProductImage({ businessId, branchId, productId: serviceId, imageId }).catch(() => undefined);
    return { id: image.id, deleted: true };
  }

  async readImage(user: AuthenticatedUser, serviceId: string, imageId: string) {
    const { businessId, branchId } = this.scope(user);
    const image = await this.prisma.serviceImage.findFirst({ where: { id: imageId, serviceId, businessId, branchId }, select: { id: true } });
    if (!image) throw new NotFoundException("تصویر خدمت پیدا نشد.");
    return this.storage.readProductImage({ businessId, branchId, productId: serviceId, imageId });
  }

  async categories(user: AuthenticatedUser, includeArchived = false) {
    const businessId = this.business(user);
    const rows = await this.prisma.serviceCategory.findMany({ where: { businessId, ...(includeArchived ? {} : { isActive: true }) }, include: { _count: { select: { services: true } }, parent: { select: { name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
    return rows.map(({ id, name, parentId, parent, isActive, _count }) => ({ id, name, parentId, parentName: parent?.name ?? null, isActive, serviceCount: _count.services }));
  }

  async createCategory(user: AuthenticatedUser, dto: CreateProductCategoryDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireEditor(user);
    const name = dto.name.trim();
    const duplicate = await this.prisma.serviceCategory.findFirst({ where: { businessId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (duplicate) throw new BadRequestException("دسته‌بندی خدماتی با این نام از قبل وجود دارد.");
    const created = await this.prisma.$transaction(async (tx) => {
      const category = await tx.serviceCategory.create({ data: { businessId, name } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "service_category.created", entityType: "service_category", entityId: category.id, requestId: request.requestId ?? "unknown", afterJson: { name } } });
      return category;
    });
    return { id: created.id, name: created.name };
  }

  async updateCategory(user: AuthenticatedUser, id: string, dto: UpdateCatalogCategoryDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireEditor(user);
    const before = await this.prisma.serviceCategory.findFirst({ where: { id, businessId } });
    if (!before) throw new NotFoundException("دسته‌بندی خدمات پیدا نشد.");
    if (dto.parentId === id) throw new BadRequestException("دسته‌بندی نمی‌تواند والد خودش باشد.");
    if (dto.parentId && !(await this.prisma.serviceCategory.findFirst({ where: { id: dto.parentId, businessId, isActive: true } }))) throw new BadRequestException("دسته‌بندی والد در دسترس نیست.");
    if (dto.isActive === false && await this.prisma.serviceCategory.count({ where: { businessId, parentId: id, isActive: true } })) throw new BadRequestException("ابتدا دسته‌های زیرمجموعه را بایگانی کنید.");
    const name = dto.name?.trim();
    if (name && await this.prisma.serviceCategory.findFirst({ where: { businessId, id: { not: id }, name: { equals: name, mode: "insensitive" } } })) throw new BadRequestException("دسته‌بندی خدماتی با این نام از قبل وجود دارد.");
    const category = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceCategory.update({ where: { id }, data: { name, parentId: dto.parentId === undefined ? undefined : dto.parentId || null, isActive: dto.isActive } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: dto.isActive === false ? "service_category.archived" : "service_category.updated", entityType: "service_category", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.name, isActive: before.isActive, parentId: before.parentId }, afterJson: { name: updated.name, isActive: updated.isActive, parentId: updated.parentId } } });
      return updated;
    });
    return { id: category.id, name: category.name, parentId: category.parentId, isActive: category.isActive };
  }

  private async resolveUnit(businessId: string, unitId?: string) {
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: unitId, businessId, isVisible: true } });
      if (!unit) throw new BadRequestException("واحد انتخاب‌شده در این کسب‌وکار قابل‌استفاده نیست.");
      return unit;
    }
    const visible = await this.prisma.unit.findMany({ where: { businessId, isVisible: true }, take: 2, select: { id: true } });
    if (visible.length !== 1) throw new BadRequestException(visible.length ? "واحد خدمت را انتخاب کنید." : "ابتدا دست‌کم یک واحد را فعال کنید.");
    return this.prisma.unit.findUniqueOrThrow({ where: { id_businessId: { id: visible[0].id, businessId } } });
  }

  private parseMoney(value: string) { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); return BigInt(value); }
  private scope(user: AuthenticatedUser) { const businessId = this.business(user); if (!user.branchId) throw new BadRequestException("ابتدا یک شعبه را انتخاب کنید."); return { businessId, branchId: user.branchId }; }
  private business(user: AuthenticatedUser) { if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید."); return user.businessId; }
  private requireEditor(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException(); }
}
