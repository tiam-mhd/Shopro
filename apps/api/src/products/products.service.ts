import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizePersianSearch } from "@shopro/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreateProductCategoryDto, CreateProductDto, UpdateProductDto } from "./products.dto.js";

const parseMoney = (value: string) => { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); return BigInt(value); };

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, search?: string, onlyLow?: string) {
    const businessId = this.business(user);
    const q = search ? normalizePersianSearch(search) : undefined;
    const rows = await this.prisma.product.findMany({
      where: { businessId, isActive: true, ...(q ? { OR: [{ normalizedName: { contains: q } }, { sku: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }] } : {}) },
      include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } }, category: { select: { id: true, name: true } }, balances: { where: { branchId: user.branchId ?? "" }, select: { quantityOnHand: true } } },
      orderBy: { normalizedName: "asc" }, take: 200,
    });
    const mapped = rows.map((row) => ({ id: row.id, name: row.name, sku: row.sku, barcode: row.barcode, kind: row.kind, unit: row.unit, category: row.category, salePriceRial: row.salePriceRial.toString(), defaultCostRial: row.defaultCostRial?.toString() ?? null, reorderPoint: row.reorderPoint?.toString() ?? null, taxRateBasisPoints: row.taxRateBasisPoints, trackInventory: row.trackInventory, quantityOnHand: row.balances[0]?.quantityOnHand.toString() ?? "0" }));
    return onlyLow === "true" ? mapped.filter((row) => row.reorderPoint !== null && Number(row.quantityOnHand) <= Number(row.reorderPoint)) : mapped;
  }

  async get(user: AuthenticatedUser, id: string) {
    const businessId = this.business(user);
    const row = await this.prisma.product.findFirst({ where: { id, businessId }, include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } }, category: { select: { id: true, name: true } }, balances: { where: { branchId: user.branchId ?? "" }, select: { quantityOnHand: true, averageCostRial: true, inventoryValueRial: true } } } });
    if (!row) throw new NotFoundException("کالا پیدا نشد.");
    return { id: row.id, name: row.name, sku: row.sku, barcode: row.barcode, kind: row.kind, unit: row.unit, category: row.category, salePriceRial: row.salePriceRial.toString(), defaultCostRial: row.defaultCostRial?.toString() ?? null, taxRateBasisPoints: row.taxRateBasisPoints, trackInventory: row.trackInventory, isActive: row.isActive, reorderPoint: row.reorderPoint?.toString() ?? null, quantityOnHand: row.balances[0]?.quantityOnHand.toString() ?? "0", averageCostRial: row.balances[0]?.averageCostRial.toString() ?? null, inventoryValueRial: row.balances[0]?.inventoryValueRial.toString() ?? null };
  }

  async create(user: AuthenticatedUser, dto: CreateProductDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, businessId } });
    if (!unit) throw new BadRequestException("واحد انتخاب‌شده متعلق به این کسب‌وکار نیست.");
    if (dto.categoryId && !(await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true } }))) throw new BadRequestException("دسته‌بندی انتخاب‌شده معتبر نیست.");
    const name = dto.name.trim();
    const product = await this.prisma.product.create({ data: { businessId, name, normalizedName: normalizePersianSearch(name), sku: dto.sku?.trim() || null, barcode: dto.barcode?.trim() || null, kind: dto.kind, unitId: dto.unitId, categoryId: dto.categoryId || null, salePriceRial: parseMoney(dto.salePriceRial), defaultCostRial: dto.defaultCostRial ? parseMoney(dto.defaultCostRial) : null, reorderPoint: dto.reorderPoint ?? null, taxRateBasisPoints: dto.taxRateBasisPoints ?? 0, trackInventory: dto.kind === "STOCK" } });
    await this.audit(user, request, "product.created", product.id, null, { name: product.name, sku: product.sku, salePriceRial: product.salePriceRial.toString() });
    return this.serialize(product);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateProductDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"]);
    const before = await this.prisma.product.findFirst({ where: { id, businessId, archivedAt: null } });
    if (!before) throw new NotFoundException("کالا پیدا نشد.");
    if (user.role === "CASHIER" && dto.salePriceRial !== undefined && parseMoney(dto.salePriceRial) !== before.salePriceRial) throw new ForbiddenException("تغییر قیمت برای نقش شما مجاز نیست.");
    if (dto.unitId && dto.unitId !== before.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, businessId }, select: { id: true } });
      if (!unit) throw new BadRequestException("واحد انتخاب‌شده متعلق به این کسب‌وکار نیست.");
      const hasMovements = await this.prisma.inventoryMovement.count({ where: { businessId, productId: id } });
      const hasCounts = await this.prisma.stockCountLine.count({ where: { businessId, productId: id } });
      if (hasMovements > 0 || hasCounts > 0) throw new BadRequestException("واحد کالایی که گردش یا شمارش موجودی دارد قابل تغییر نیست.");
    }
    if (dto.categoryId && !(await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true }, select: { id: true } }))) throw new BadRequestException("دسته‌بندی انتخاب‌شده متعلق به این کسب‌وکار نیست.");
    const product = await this.prisma.product.update({ where: { id }, data: { name: dto.name?.trim(), normalizedName: dto.name ? normalizePersianSearch(dto.name) : undefined, sku: dto.sku === undefined ? undefined : dto.sku?.trim() || null, barcode: dto.barcode === undefined ? undefined : dto.barcode?.trim() || null, unitId: dto.unitId, categoryId: dto.categoryId === undefined ? undefined : dto.categoryId || null, salePriceRial: dto.salePriceRial ? parseMoney(dto.salePriceRial) : undefined, defaultCostRial: dto.defaultCostRial === undefined ? undefined : dto.defaultCostRial ? parseMoney(dto.defaultCostRial) : null, reorderPoint: dto.reorderPoint === undefined ? undefined : dto.reorderPoint || null, taxRateBasisPoints: dto.taxRateBasisPoints, isActive: dto.isActive, archivedAt: dto.isActive === false ? new Date() : dto.isActive === true ? null : undefined } });
    await this.audit(user, request, dto.salePriceRial !== undefined ? "product.price.updated" : "product.updated", id, { name: before.name, salePriceRial: before.salePriceRial.toString(), isActive: before.isActive }, { name: product.name, salePriceRial: product.salePriceRial.toString(), isActive: product.isActive });
    return this.serialize(product);
  }

  async units(user: AuthenticatedUser) {
    const businessId = this.business(user);
    return this.prisma.unit.findMany({ where: { businessId }, select: { id: true, code: true, labelFa: true, precision: true }, orderBy: { labelFa: "asc" } });
  }

  async categories(user: AuthenticatedUser) {
    const businessId = this.business(user);
    return this.prisma.productCategory.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  async createCategory(user: AuthenticatedUser, dto: CreateProductCategoryDto, request: AppRequest) {
    const businessId = this.business(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const name = dto.name.trim();
    const duplicate = await this.prisma.productCategory.findFirst({ where: { businessId, name: { equals: name, mode: "insensitive" }, isActive: true }, select: { id: true } });
    if (duplicate) throw new BadRequestException("دسته‌ای با این نام از قبل وجود دارد.");
    const category = await this.prisma.productCategory.create({ data: { businessId, name } });
    await this.prisma.auditEvent.create({ data: { businessId, actorId: user.id, action: "product_category.created", entityType: "product_category", entityId: category.id, requestId: request.requestId ?? "unknown", afterJson: { name } } });
    return { id: category.id, name: category.name };
  }

  private serialize(product: { id: string; name: string; sku: string | null; barcode: string | null; kind: string; salePriceRial: bigint; defaultCostRial: bigint | null; taxRateBasisPoints: number; trackInventory: boolean }) { return { id: product.id, name: product.name, sku: product.sku, barcode: product.barcode, kind: product.kind, salePriceRial: product.salePriceRial.toString(), defaultCostRial: product.defaultCostRial?.toString() ?? null, taxRateBasisPoints: product.taxRateBasisPoints, trackInventory: product.trackInventory }; }
  private business(user: AuthenticatedUser) { if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید."); return user.businessId; }
  private requireRole(user: AuthenticatedUser, allowed: string[]) { if (!allowed.includes(user.role ?? "")) throw new ForbiddenException(); }
  private audit(user: AuthenticatedUser, request: AppRequest, action: string, entityId: string, beforeJson: object | null, afterJson: object) { return this.prisma.auditEvent.create({ data: { businessId: user.businessId!, actorId: user.id, action, entityType: "product", entityId, requestId: request.requestId ?? "unknown", beforeJson: beforeJson ?? undefined, afterJson } }); }
}
