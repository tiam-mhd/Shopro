import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { Storefront } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService } from "../finance/accounting.service.js";
import { AuthService } from "../auth/auth.service.js";
import { SalesService } from "../sales/sales.service.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { MAX_ATTACHMENT_BYTES, prepareExpenseAttachment } from "../expenses/attachment-files.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { entitlementDenial } from "../subscriptions/subscription-entitlement.guard.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import type { CreateStorePaymentCardDto, CreateStorefrontOrderDto, CreateStorefrontReceiptDto, RejectStorefrontOrderDto, RejectStorefrontPaymentDto, ResolveStorefrontOverpaymentDto, SetStorePaymentCardActiveDto, StorefrontListingDto, StorefrontSettingsDto, TransitionStorefrontOrderDto, VerifyStorefrontPaymentDto } from "./storefront.dto.js";
import { assertAllowedTransition, extensionRial, formatStockPolicy, isValidIranianCard, normalizeIranianMobile, normalizeStoreSlug, parseMoney, paymentAllocationPlan, quantityMilli, quantityMilliForPrecision, quantityMilliOrZero, quantityText, taxRial, trackingTokenForOrder } from "./storefront-core.js";
import { decryptStoreCardNumber, encryptStoreCardNumber, maskedCardLast4 } from "./storefront-crypto.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function publicCardSnapshot(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const card = value as unknown as Record<string, unknown>;
  const last4 = typeof card.last4 === "string" ? card.last4 : typeof card.cardNumber === "string" ? card.cardNumber.slice(-4) : "";
  return { bankName: typeof card.bankName === "string" ? card.bankName : null, holderName: typeof card.holderName === "string" ? card.holderName : null, last4 };
}
const isUnique = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
const isSerializationConflict = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2034";

type Scope = { businessId: string; branchId: string };
const customerOrderInclude = {
  items: true,
  storefront: { select: { publicName: true, slug: true, phone: true, paymentInstructions: true } },
  events: { orderBy: { createdAt: "asc" as const } },
  paymentAttempts: { orderBy: { createdAt: "desc" as const }, include: { receipt: { select: { mimeType: true, bytes: true } } } },
} satisfies Prisma.StorefrontOrderInclude;
const adminOrderInclude = {
  items: true,
  events: { orderBy: { createdAt: "asc" as const } },
  paymentAttempts: { orderBy: { createdAt: "desc" as const }, include: { receipt: { select: { id: true, mimeType: true, bytes: true, uploadedAt: true } }, cashTransaction: { select: { id: true, amountRial: true, reference: true } } } },
  salesInvoice: { select: { id: true, invoiceNo: true, status: true } },
} satisfies Prisma.StorefrontOrderInclude;
type CustomerOrder = Prisma.StorefrontOrderGetPayload<{ include: typeof customerOrderInclude }>;
type AdminOrder = Prisma.StorefrontOrderGetPayload<{ include: typeof adminOrderInclude }>;

@Injectable()
export class StorefrontService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService, private readonly auth: AuthService, private readonly sales: SalesService, private readonly storage: AttachmentStorageService) {}

  onModuleInit() {
    this.expiryTimer = setInterval(() => { void this.expireOverdueOrders().catch(() => undefined); }, 60_000);
    this.expiryTimer.unref();
  }

  onModuleDestroy() { if (this.expiryTimer) clearInterval(this.expiryTimer); }

  async requestCheckoutOtp(slug: string, phone: string, request: AppRequest) {
    await this.checkPublicRateLimit("otp", request.ip, 5);
    const store = await this.findPublicStore(slug, true);
    if (!await this.newOrdersAllowed(store.businessId, store.branchId)) throw new ConflictException("این شعبه فعلاً سفارش جدید نمی‌پذیرد.");
    await this.auth.requestOtp(phone, "STOREFRONT_CHECKOUT", request.ip, request.requestId);
    return { ok: true, message: "اگر شماره معتبر باشد، کد تأیید برای آن ارسال می‌شود." };
  }

  async verifyCheckoutOtp(slug: string, phone: string, code: string, ipAddress?: string) {
    await this.checkPublicRateLimit("otp-verify", ipAddress, 10);
    const store = await this.findPublicStore(slug, true);
    return this.auth.verifyStorefrontOtp(phone, code, store.slug);
  }

  async publicStore(slug: string, ipAddress?: string) {
    await this.checkPublicRateLimit("store", ipAddress, 120);
    const store = await this.findPublicStore(slug, false);
    const business = await this.prisma.business.findUnique({ where: { id: store.businessId }, select: { displayName: true, inventoryEnabled: true } });
    const branch = await this.prisma.branch.findFirst({ where: { id: store.branchId, businessId: store.businessId }, select: { name: true, isActive: true } });
    const accepting = store.status === "PUBLISHED" && Boolean(branch?.isActive) && await this.newOrdersAllowed(store.businessId, store.branchId);
    return {
      slug: store.slug, name: store.publicName, businessName: business?.displayName ?? store.publicName,
      branchName: branch?.name ?? "", description: store.description, phone: store.phone,
      address: store.showAddress ? store.address : null, status: store.status,
      acceptingOrders: accepting, closedMessage: "این شعبه فعلاً سفارش جدید نمی‌پذیرد.",
      acceptsPickup: store.acceptsPickup, acceptsLocalDelivery: store.acceptsLocalDelivery,
      deliveryFeeRial: store.deliveryFeeRial.toString(), showExactStock: store.showExactStock,
      preparationMinutes: store.preparationMinutes, cancellationPolicy: store.cancellationPolicy,
      paymentInstructions: store.paymentInstructions,
    };
  }

  async publicProducts(slug: string, search?: string, requestedLimit?: string, cursor?: string, ipAddress?: string) {
    await this.checkPublicRateLimit("catalog", ipAddress, 120);
    const store = await this.findPublicStore(slug, false);
    const limit = pageLimit(requestedLimit, 24, 60);
    const q = search?.trim() ? normalizePersianSearch(search.trim().slice(0, 100)) : undefined;
    if (cursor && !(await this.prisma.storefrontListing.findFirst({ where: { id: cursor, storefrontId: store.id, isPublished: true }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحهٔ کالا معتبر نیست؛ فهرست را تازه کنید.");
    const rows = await this.prisma.storefrontListing.findMany({
      where: {
        storefrontId: store.id, branchId: store.branchId, businessId: store.businessId, isPublished: true,
        canOrder: true, product: { isActive: true, archivedAt: null },
        ...(q ? { OR: [{ publicTitle: { contains: q, mode: "insensitive" as const } }, { product: { normalizedName: { contains: q } } }] } : {}),
      },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        product: { include: {
          unit: { select: { labelFa: true, code: true, precision: true } },
          category: { select: { name: true } },
          balances: { where: { branchId: store.branchId }, select: { quantityOnHand: true } },
        } },
      },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }], take: limit + 1,
    });
    const products = rows.map((row) => {
      const product = row.product;
      const unitPrice = row.publicPriceRial ?? product.salePriceRial;
      const onHand = product.trackInventory ? product.balances[0]?.quantityOnHand.toString() ?? "0" : "0";
      const stock = product.trackInventory ? formatStockPolicy(row.stockPolicy, onHand, store.showExactStock) : { stockLabel: row.stockPolicy === "INQUIRY" ? "استعلام موجودی" : "موجود", available: true, quantityOnHand: null };
      return {
        id: row.id, title: row.publicTitle?.trim() || product.name,
        description: row.publicDescription?.trim() || null,
        kind: product.kind, category: product.category?.name ?? null,
        unit: product.unit.labelFa, unitCode: product.unit.code, unitPrecision: product.unit.precision,
        unitPriceRial: unitPrice.toString(), taxRateBasisPoints: product.taxRateBasisPoints,
        stockLabel: stock.stockLabel, available: stock.available, quantityOnHand: stock.quantityOnHand,
        minimumQuantity: row.minimumQuantity.toString(), maximumQuantity: row.maximumQuantity?.toString() ?? null,
      };
    });
    return cursorPage(products, limit, (row) => row.id);
  }

  async settings(user: AuthenticatedUser) {
    const scope = this.scope(user);
    const row = await this.prisma.storefront.findFirst({ where: scope });
    return row ? this.settingsDto(row) : { settings: null };
  }

  async updateSettings(user: AuthenticatedUser, dto: StorefrontSettingsDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER"]);
    if (!dto.acceptsPickup && !dto.acceptsLocalDelivery) throw new BadRequestException("دست‌کم یک روش دریافت را فعال کنید.");
    const slug = normalizeStoreSlug(dto.slug);
    const fee = parseMoney(dto.deliveryFeeRial, "هزینهٔ ارسال");
    if (fee > 0n && !dto.acceptsLocalDelivery) throw new BadRequestException("برای ثبت هزینه، ارسال محلی را فعال کنید.");
    const phone = dto.phone?.trim() ? normalizeIranianMobile(dto.phone) : null;
    const before = await this.prisma.storefront.findFirst({ where: scope });
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const saved = before
          ? await tx.storefront.update({ where: { id: before.id }, data: {
            slug, status: dto.status, publicName: dto.publicName.trim(), description: dto.description?.trim() || null,
            phone, address: dto.address?.trim() || null, showAddress: dto.showAddress, acceptsPickup: dto.acceptsPickup,
            acceptsLocalDelivery: dto.acceptsLocalDelivery, deliveryFeeRial: fee, showExactStock: dto.showExactStock,
            preparationMinutes: dto.preparationMinutes ?? null, paymentInstructions: dto.paymentInstructions?.trim() || null,
            cancellationPolicy: dto.cancellationPolicy?.trim() || null, updatedBy: user.id,
          } })
          : await tx.storefront.create({ data: {
            ...scope, slug, status: dto.status, publicName: dto.publicName.trim(), description: dto.description?.trim() || null,
            phone, address: dto.address?.trim() || null, showAddress: dto.showAddress, acceptsPickup: dto.acceptsPickup,
            acceptsLocalDelivery: dto.acceptsLocalDelivery, deliveryFeeRial: fee, showExactStock: dto.showExactStock,
            preparationMinutes: dto.preparationMinutes ?? null, paymentInstructions: dto.paymentInstructions?.trim() || null,
            cancellationPolicy: dto.cancellationPolicy?.trim() || null, createdBy: user.id, updatedBy: user.id,
          } });
        await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: before ? "storefront.settings.updated" : "storefront.created", entityType: "storefront", entityId: saved.id, requestId: request.requestId ?? "unknown", beforeJson: before ? { slug: before.slug, status: before.status, publicName: before.publicName } : undefined, afterJson: { slug: saved.slug, status: saved.status, publicName: saved.publicName } } });
        return saved;
      });
      return this.settingsDto(row);
    } catch (error) {
      if (isUnique(error)) throw new ConflictException("این نشانی فروشگاه قبلاً انتخاب شده است.");
      throw error;
    }
  }

  async listings(user: AuthenticatedUser) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER"]);
    const store = await this.requireStore(scope);
    const products = await this.prisma.product.findMany({ where: { businessId: scope.businessId, isActive: true, archivedAt: null }, include: { unit: { select: { labelFa: true } }, category: { select: { name: true } }, balances: { where: { branchId: scope.branchId }, select: { quantityOnHand: true } }, storefrontListings: { where: { branchId: scope.branchId }, take: 1 } }, orderBy: [{ normalizedName: "asc" }, { id: "asc" }], take: 500 });
    return { storefrontId: store.id, items: products.map((product) => {
      const row = product.storefrontListings[0];
      return {
        productId: product.id, name: product.name, sku: product.sku, kind: product.kind,
        category: product.category?.name ?? null, unit: product.unit.labelFa,
        salePriceRial: product.salePriceRial.toString(), taxRateBasisPoints: product.taxRateBasisPoints,
        quantityOnHand: product.balances[0]?.quantityOnHand.toString() ?? "0", trackInventory: product.trackInventory,
        listing: row ? { id: row.id, publicTitle: row.publicTitle ?? product.name, publicDescription: row.publicDescription ?? "", publicPriceRial: row.publicPriceRial?.toString() ?? "", isPublished: row.isPublished, canOrder: row.canOrder, stockPolicy: row.stockPolicy, minimumQuantity: row.minimumQuantity.toString(), maximumQuantity: row.maximumQuantity?.toString() ?? "", displayOrder: row.displayOrder } : null,
      };
    }) };
  }

  async updateListing(user: AuthenticatedUser, productId: string, dto: StorefrontListingDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER"]);
    const store = await this.requireStore(scope);
    const product = await this.prisma.product.findFirst({ where: { id: productId, businessId: scope.businessId, isActive: true, archivedAt: null }, select: { id: true, salePriceRial: true, name: true, unit: { select: { precision: true } } } });
    if (!product) throw new NotFoundException("کالا یا خدمت فعال پیدا نشد.");
    const price = dto.publicPriceRial ? parseMoney(dto.publicPriceRial, "قیمت عمومی") : null;
    const minimum = quantityMilliForPrecision(dto.minimumQuantity, product.unit.precision);
    const maximum = dto.maximumQuantity ? quantityMilliForPrecision(dto.maximumQuantity, product.unit.precision) : null;
    if (maximum !== null && maximum < minimum) throw new BadRequestException("حداکثر تعداد نمی‌تواند از حداقل کمتر باشد.");
    if (dto.isPublished && (price ?? product.salePriceRial) <= 0n) throw new BadRequestException("برای انتشار، قیمت عمومی باید از صفر بیشتر باشد.");
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storefrontListing.upsert({
        where: { branchId_productId: { branchId: scope.branchId, productId } },
        create: { ...scope, storefrontId: store.id, productId, publicTitle: dto.publicTitle.trim(), publicDescription: dto.publicDescription?.trim() || null, publicPriceRial: price, isPublished: dto.isPublished, canOrder: dto.canOrder, stockPolicy: dto.stockPolicy, minimumQuantity: new Prisma.Decimal(quantityText(minimum)), maximumQuantity: maximum === null ? null : new Prisma.Decimal(quantityText(maximum)), displayOrder: dto.displayOrder },
        update: { publicTitle: dto.publicTitle.trim(), publicDescription: dto.publicDescription?.trim() || null, publicPriceRial: price, isPublished: dto.isPublished, canOrder: dto.canOrder, stockPolicy: dto.stockPolicy, minimumQuantity: new Prisma.Decimal(quantityText(minimum)), maximumQuantity: maximum === null ? null : new Prisma.Decimal(quantityText(maximum)), displayOrder: dto.displayOrder },
      });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.listing.updated", entityType: "storefront_listing", entityId: saved.id, requestId: request.requestId ?? "unknown", afterJson: { productId, isPublished: saved.isPublished, canOrder: saved.canOrder, priceRial: saved.publicPriceRial?.toString() ?? null } } });
      return saved;
    });
    return { id: row.id, productId, isPublished: row.isPublished, canOrder: row.canOrder };
  }

  async cards(user: AuthenticatedUser) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER"]);
    const rows = await this.prisma.storePaymentCard.findMany({ where: scope, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], include: { financeAccount: { select: { name: true, isActive: true } } } });
    return rows.map((row) => ({ id: row.id, bankName: row.bankName, holderName: row.holderName, maskedCardNumber: maskedCardLast4(row.cardLast4), label: row.label, instructions: row.instructions, displayOrder: row.displayOrder, isActive: row.isActive, financeAccountId: row.financeAccountId, financeAccountName: row.financeAccount.name, accountActive: row.financeAccount.isActive }));
  }

  async createCard(user: AuthenticatedUser, dto: CreateStorePaymentCardDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER"]);
    const cardNumber = toAsciiDigits(dto.cardNumber).replace(/[\s-]/g, "");
    if (!isValidIranianCard(cardNumber)) throw new BadRequestException("شمارهٔ کارت مقصد معتبر نیست.");
    const account = await this.prisma.financeAccount.findFirst({ where: { id: dto.financeAccountId, ...scope, isActive: true, kind: "BANK" }, select: { id: true } });
    if (!account) throw new BadRequestException("حساب مالی فعال همین شعبه را انتخاب کنید.");
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storePaymentCard.create({ data: { ...scope, financeAccountId: account.id, bankName: dto.bankName.trim(), holderName: dto.holderName.trim(), cardNumberEncrypted: encryptStoreCardNumber(cardNumber), cardLast4: cardNumber.slice(-4), label: dto.label?.trim() || null, instructions: dto.instructions?.trim() || null, displayOrder: dto.displayOrder, createdBy: user.id, updatedBy: user.id } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.payment_card.created", entityType: "store_payment_card", entityId: saved.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, bankName: saved.bankName, last4: cardNumber.slice(-4), financeAccountId: account.id } } });
      return saved;
    });
    return { id: row.id, bankName: row.bankName, holderName: row.holderName, maskedCardNumber: maskedCardLast4(row.cardLast4), isActive: row.isActive };
  }

  async updateCard(user: AuthenticatedUser, cardId: string, dto: SetStorePaymentCardActiveDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER"]);
    const before = await this.prisma.storePaymentCard.findFirst({ where: { id: cardId, ...scope } });
    if (!before) throw new NotFoundException("کارت مقصد پیدا نشد.");
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storePaymentCard.update({ where: { id: before.id }, data: { isActive: dto.isActive, displayOrder: dto.displayOrder ?? before.displayOrder, updatedBy: user.id } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.payment_card.updated", entityType: "store_payment_card", entityId: saved.id, requestId: request.requestId ?? "unknown", beforeJson: { isActive: before.isActive, displayOrder: before.displayOrder }, afterJson: { branchId: scope.branchId, isActive: saved.isActive, displayOrder: saved.displayOrder, last4: saved.cardLast4 } } });
      return saved;
    });
    return { id: row.id, maskedCardNumber: maskedCardLast4(row.cardLast4), isActive: row.isActive, displayOrder: row.displayOrder };
  }

  async createOrder(slug: string, dto: CreateStorefrontOrderDto, key: string | undefined, request: AppRequest) {
    await this.checkPublicRateLimit("order", request.ip, 12, 60 * 60 * 1000);
    if (!key || !/^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/.test(key)) throw new BadRequestException("هدر Idempotency-Key برای ثبت سفارش الزامی است.");
    const store = await this.findPublicStore(slug, true);
    if (!await this.newOrdersAllowed(store.businessId, store.branchId)) throw new ConflictException("این شعبه فعلاً سفارش جدید نمی‌پذیرد.");
    if (dto.lines.length > 100 || new Set(dto.lines.map((line) => line.listingId)).size !== dto.lines.length) throw new BadRequestException("هر کالا را در یک ردیف از سفارش وارد کنید.");
    const phone = normalizeIranianMobile(dto.customerPhone);
    const input = {
      name: dto.customerName.trim(), phone, deliveryMethod: dto.deliveryMethod,
      deliveryAddress: dto.deliveryAddress?.trim() || null, customerNote: dto.customerNote?.trim() || null,
      expectedTotalRial: dto.expectedTotalRial,
      lines: dto.lines.map((line) => ({ listingId: line.listingId, quantity: line.quantity.trim(), expectedUnitPriceRial: line.expectedUnitPriceRial, expectedTaxRateBasisPoints: line.expectedTaxRateBasisPoints })),
    };
    const requestHash = this.accounting.idempotencyHash(input);
    const prior = await this.prisma.storefrontOrder.findUnique({ where: { businessId_branchId_idempotencyKey: { businessId: store.businessId, branchId: store.branchId, idempotencyKey: key } } });
    if (prior) return this.createdOrderResult(prior, requestHash);

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const currentStore = await tx.storefront.findFirst({ where: { id: store.id, status: "PUBLISHED", branch: { isActive: true } } });
        if (!currentStore) throw new ConflictException("این شعبه فعلاً سفارش جدید نمی‌پذیرد.");
        const existing = await tx.storefrontOrder.findUnique({ where: { businessId_branchId_idempotencyKey: { businessId: store.businessId, branchId: store.branchId, idempotencyKey: key } } });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new ConflictException("این کلید سفارش قبلاً برای اطلاعات دیگری استفاده شده است.");
          return existing;
        }
        const grants = await tx.storefrontOtpGrant.findFirst({ where: { storefrontId: store.id, businessId: store.businessId, branchId: store.branchId, phone, tokenHash: hash(dto.checkoutToken), consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
        if (!grants) throw new UnauthorizedException("تأیید شمارهٔ موبایل پایان یافته است؛ دوباره شماره را تأیید کنید.");
        const [business, listings] = await Promise.all([
          tx.business.findUniqueOrThrow({ where: { id: store.businessId }, select: { inventoryEnabled: true } }),
          tx.storefrontListing.findMany({ where: { id: { in: input.lines.map((line) => line.listingId) }, storefrontId: store.id, businessId: store.businessId, branchId: store.branchId, isPublished: true, canOrder: true, product: { isActive: true, archivedAt: null } }, include: { product: { include: { unit: true, balances: { where: { branchId: store.branchId }, select: { quantityOnHand: true } } } } } }),
        ]);
        if (listings.length !== input.lines.length) throw new ConflictException("یک یا چند کالا دیگر برای سفارش در دسترس نیست.");
        const listingMap = new Map(listings.map((row) => [row.id, row]));
        const priceChanges: Array<{ listingId: string; title: string; expectedPriceRial: string; currentPriceRial: string; expectedTaxRateBasisPoints: number; currentTaxRateBasisPoints: number }> = [];
        const computed = input.lines.map((line) => {
          const listing = listingMap.get(line.listingId)!;
          const quantity = quantityMilliForPrecision(line.quantity, listing.product.unit.precision);
          const minimum = quantityMilliForPrecision(listing.minimumQuantity.toString(), listing.product.unit.precision);
          const maximum = listing.maximumQuantity ? quantityMilliForPrecision(listing.maximumQuantity.toString(), listing.product.unit.precision) : null;
          if (quantity < minimum || (maximum !== null && quantity > maximum)) throw new BadRequestException(`تعداد «${listing.publicTitle ?? listing.product.name}» خارج از محدودهٔ سفارش است.`);
          const currentPrice = listing.publicPriceRial ?? listing.product.salePriceRial;
          const expectedPrice = parseMoney(line.expectedUnitPriceRial, "قیمت کالا");
          if (expectedPrice !== currentPrice || line.expectedTaxRateBasisPoints !== listing.product.taxRateBasisPoints) priceChanges.push({
            listingId: listing.id, title: listing.publicTitle ?? listing.product.name,
            expectedPriceRial: expectedPrice.toString(), currentPriceRial: currentPrice.toString(),
            expectedTaxRateBasisPoints: line.expectedTaxRateBasisPoints, currentTaxRateBasisPoints: listing.product.taxRateBasisPoints,
          });
          return { line, listing, quantity, unitPrice: currentPrice, base: extensionRial(quantity, currentPrice), taxRate: listing.product.taxRateBasisPoints };
        });
        if (input.deliveryMethod === "PICKUP" && !currentStore.acceptsPickup) throw new BadRequestException("تحویل حضوری برای این فروشگاه فعال نیست.");
        if (input.deliveryMethod === "LOCAL_DELIVERY" && !currentStore.acceptsLocalDelivery) throw new BadRequestException("ارسال محلی برای این فروشگاه فعال نیست.");
        if (input.deliveryMethod === "LOCAL_DELIVERY" && !input.deliveryAddress) throw new BadRequestException("نشانی تحویل را وارد کنید.");
        if (input.deliveryMethod === "PICKUP" && input.deliveryAddress) throw new BadRequestException("برای تحویل حضوری نشانی ارسال لازم نیست.");
        const deliveryFee = input.deliveryMethod === "LOCAL_DELIVERY" ? currentStore.deliveryFeeRial : 0n;
        const subtotal = computed.reduce((sum, item) => sum + item.base, 0n);
        const taxes = computed.map((item) => taxRial(item.base, item.taxRate));
        const tax = taxes.reduce((sum, amount) => sum + amount, 0n);
        const currentTotal = subtotal + tax + deliveryFee;
        const expectedTotal = parseMoney(input.expectedTotalRial, "مبلغ نهایی سفارش");
        if (priceChanges.length || expectedTotal !== currentTotal) throw new ConflictException({
          code: "PRICE_CHANGED", message: "قیمت، مالیات یا هزینهٔ دریافت سفارش تغییر کرده است. مبلغ تازه را بررسی و دوباره تأیید کنید.",
          changes: priceChanges, expectedTotalRial: expectedTotal.toString(), currentTotalRial: currentTotal.toString(),
        });
        for (const item of computed) {
          const product = item.listing.product;
          if (business.inventoryEnabled && product.kind === "STOCK" && product.trackInventory && item.listing.stockPolicy !== "INQUIRY") {
            const available = await this.availableStock(tx, store.businessId, store.branchId, product.id, product.balances[0]?.quantityOnHand.toString() ?? "0", new Date());
            if (available < item.quantity) throw new ConflictException({ code: "STOCK_CHANGED", message: `موجودی «${item.listing.publicTitle ?? product.name}» تغییر کرده است؛ سبد را تازه کنید.` });
          }
        }
        const id = randomUUID();
        const publicCode = await this.accounting.nextDocumentNumber(tx, { businessId: store.businessId, type: "STOREFRONT_ORDER", prefix: "SP" });
        const trackingToken = trackingTokenForOrder(id, store.businessId);
        const consumed = await tx.storefrontOtpGrant.updateMany({ where: { id: grants.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
        if (consumed.count !== 1) throw new UnauthorizedException("تأیید شمارهٔ موبایل پیش‌تر استفاده شده یا منقضی است.");
        const created = await tx.storefrontOrder.create({ data: {
          id, businessId: store.businessId, branchId: store.branchId, storefrontId: store.id, publicCode,
          trackingTokenHash: hash(trackingToken), idempotencyKey: key, requestHash,
          customerName: input.name, customerPhone: phone, deliveryMethod: input.deliveryMethod,
          deliveryAddress: input.deliveryAddress, customerNote: input.customerNote,
          subtotalRial: subtotal, taxRial: tax, deliveryFeeRial: deliveryFee, totalRial: subtotal + tax + deliveryFee,
          paymentStatus: "NOT_DUE", status: "SUBMITTED",
          items: { create: computed.map((item, index) => ({
            businessId: store.businessId, branchId: store.branchId, listingId: item.listing.id,
            productId: item.listing.product.id, titleSnapshot: item.listing.publicTitle?.trim() || item.listing.product.name,
            skuSnapshot: item.listing.product.sku, unitCodeSnapshot: item.listing.product.unit.code,
            quantity: new Prisma.Decimal(quantityText(item.quantity)), unitPriceRial: item.unitPrice,
            taxRateBasisPoints: item.taxRate, taxRial: taxes[index], lineTotalRial: item.base + taxes[index],
          })) },
          events: { create: { newStatus: "SUBMITTED", actorType: "CUSTOMER", customerMessage: "درخواست سفارش برای فروشگاه ارسال شد." } },
        } });
        await tx.auditEvent.create({ data: { businessId: store.businessId, actorId: null, action: "storefront.order.submitted", entityType: "storefront_order", entityId: created.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: store.branchId, publicCode, itemCount: computed.length, totalRial: created.totalRial.toString() } } });
        return created;
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
      return this.createdOrderResult(order, requestHash);
    } catch (error) {
      if (isUnique(error) || isSerializationConflict(error)) {
        const raced = await this.prisma.storefrontOrder.findUnique({ where: { businessId_branchId_idempotencyKey: { businessId: store.businessId, branchId: store.branchId, idempotencyKey: key } } });
        if (raced) return this.createdOrderResult(raced, requestHash);
        if (isUnique(error)) throw new ConflictException("این کلید سفارش قبلاً برای درخواست دیگری استفاده شده است.");
      }
      throw error;
    }
  }

  async customerOrder(token: string, ipAddress?: string) {
    await this.checkPublicRateLimit("tracking", ipAddress, 120);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException("سفارش پیدا نشد؛ پیوند پیگیری را بررسی کنید.");
    const order = await this.prisma.storefrontOrder.findFirst({ where: { trackingTokenHash: this.trackingHash(token) }, include: customerOrderInclude });
    if (!order) throw new NotFoundException("سفارش پیدا نشد؛ پیوند پیگیری را بررسی کنید.");
    const cards = order.status === "ACCEPTED" && !["VERIFIED", "OVERPAID_REVIEW"].includes(order.paymentStatus)
      ? await this.prisma.storePaymentCard.findMany({ where: { businessId: order.businessId, branchId: order.branchId, isActive: true, financeAccount: { isActive: true, kind: "BANK" } }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, bankName: true, holderName: true, cardNumberEncrypted: true, label: true, instructions: true } })
      : [];
    return {
      publicCode: order.publicCode, storeName: order.storefront.publicName, storeSlug: order.storefront.slug,
      storePhone: order.storefront.phone, paymentInstructions: order.storefront.paymentInstructions,
      status: order.status, paymentStatus: order.paymentStatus, createdAt: order.createdAt.toISOString(),
      paymentDueAt: order.paymentDueAt?.toISOString() ?? null, deliveryMethod: order.deliveryMethod,
       items: order.items.map((item) => ({ title: item.titleSnapshot, quantity: item.quantity.toString(), unitCode: item.unitCodeSnapshot, unitPriceRial: item.unitPriceRial.toString(), taxRial: item.taxRial.toString(), lineTotalRial: item.lineTotalRial.toString() })),
      subtotalRial: order.subtotalRial.toString(), taxRial: order.taxRial.toString(), deliveryFeeRial: order.deliveryFeeRial.toString(), totalRial: order.totalRial.toString(),
      verifiedAmountRial: order.paymentAttempts.filter((attempt) => ["VERIFIED", "PARTIALLY_VERIFIED"].includes(attempt.status)).reduce((sum, attempt) => sum + (attempt.verifiedAmountRial ?? 0n), 0n).toString(),
      paymentAttempts: order.paymentAttempts.map((attempt) => ({ status: attempt.status, submittedAmountRial: attempt.submittedAmountRial.toString(), rejectionReason: attempt.rejectionReason, createdAt: attempt.createdAt.toISOString(), mimeType: attempt.receipt?.mimeType ?? null, receiptBytes: attempt.receipt?.bytes.toString() ?? null, card: publicCardSnapshot(attempt.cardSnapshot) })),
      cards: cards.map((card) => ({ id: card.id, bankName: card.bankName, holderName: card.holderName, cardNumber: decryptStoreCardNumber(card.cardNumberEncrypted), label: card.label, instructions: card.instructions })),
      timeline: order.events.map((event) => ({ status: event.newStatus, at: event.createdAt.toISOString(), message: event.customerMessage })),
    };
  }

  async cancelByCustomer(token: string, ipAddress?: string) {
    await this.checkPublicRateLimit("cancel", ipAddress, 10);
    const order = await this.findOrderByTrackingToken(token);
    if (order.status !== "SUBMITTED") throw new ConflictException("لغو از صفحهٔ پیگیری فقط پیش از پذیرش فروشگاه ممکن است.");
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.storefrontOrder.updateMany({ where: { id: order.id, status: "SUBMITTED" }, data: { status: "CANCELLED" } });
      if (changed.count !== 1) throw new ConflictException("وضعیت سفارش هم‌زمان تغییر کرده است.");
      await tx.storefrontOrderEvent.create({ data: { businessId: order.businessId, branchId: order.branchId, orderId: order.id, previousStatus: "SUBMITTED", newStatus: "CANCELLED", actorType: "CUSTOMER", customerMessage: "مشتری پیش از پذیرش فروشگاه درخواست را لغو کرد." } });
    });
    return { ok: true };
  }

  async submitReceipt(token: string, dto: CreateStorefrontReceiptDto, file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined, ipAddress?: string) {
    await this.checkPublicRateLimit("receipt", ipAddress, 10, 10 * 60 * 1000);
    const order = await this.findOrderByTrackingToken(token);
    const now = new Date();
    if (order.status !== "ACCEPTED" || ["VERIFIED", "OVERPAID_REVIEW", "REFUNDED", "REFUND_PENDING"].includes(order.paymentStatus)) throw new ConflictException("این سفارش اکنون رسید تازه نمی‌پذیرد.");
    if (order.paymentDueAt && order.paymentDueAt <= now && order.paymentStatus !== "UNDER_REVIEW") {
      await this.expireOneOrder(order.id, order.businessId, order.branchId);
      throw new ConflictException("مهلت پرداخت پایان یافته است. برای راهنمایی با فروشگاه تماس بگیرید.");
    }
    const prepared = prepareExpenseAttachment(file);
    if (prepared.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new BadRequestException("حجم رسید از حد مجاز بیشتر است.");
    const card = await this.prisma.storePaymentCard.findFirst({ where: { id: dto.cardId, businessId: order.businessId, branchId: order.branchId, isActive: true, financeAccount: { isActive: true, kind: "BANK" } } });
    if (!card) throw new BadRequestException("کارت مقصد فعال همین شعبه را انتخاب کنید.");
    const submitted = parseMoney(dto.submittedAmountRial, "مبلغ اعلام‌شده");
    if (submitted <= 0n) throw new BadRequestException("مبلغ واریزی باید از صفر بیشتر باشد.");
    if (dto.transferredAt && Number.isNaN(Date.parse(dto.transferredAt))) throw new BadRequestException("تاریخ انتقال وجه معتبر نیست.");
    const pending = await this.prisma.storefrontPaymentAttempt.count({ where: { orderId: order.id, status: "UNDER_REVIEW" } });
    if (pending) throw new ConflictException("رسید قبلی این سفارش هنوز در انتظار بررسی است.");
    const attempts = await this.prisma.storefrontPaymentAttempt.count({ where: { orderId: order.id } });
    if (attempts >= 5) throw new ConflictException("تعداد تلاش‌های ارسال رسید به حد مجاز رسیده است؛ با فروشگاه تماس بگیرید.");
    const duplicate = await this.prisma.storefrontReceipt.findFirst({ where: { checksum: prepared.checksum }, select: { id: true } });
    if (duplicate) throw new ConflictException("این فایل رسید قبلاً برای یک سفارش استفاده شده است.");
    const storageKey = `${randomUUID()}.${prepared.extension}`;
    await this.storage.save(storageKey, prepared.bytes);
    try {
      const attempt = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.storefrontOrder.findFirst({ where: { id: order.id, businessId: order.businessId, branchId: order.branchId, status: "ACCEPTED", paymentStatus: { not: "VERIFIED" } } });
        if (!fresh) throw new ConflictException("وضعیت سفارش هم‌زمان تغییر کرده است.");
        if (fresh.paymentStatus === "OVERPAID_REVIEW") throw new ConflictException("این سفارش به‌دلیل اضافه‌پرداخت در حال بررسی دستی است.");
        if (fresh.paymentDueAt && fresh.paymentDueAt <= new Date() && fresh.paymentStatus !== "UNDER_REVIEW") throw new ConflictException("مهلت پرداخت پایان یافته است؛ برای راهنمایی با فروشگاه تماس بگیرید.");
        const pendingAttempt = await tx.storefrontPaymentAttempt.findFirst({ where: { orderId: order.id, status: "UNDER_REVIEW" }, select: { id: true } });
        if (pendingAttempt) throw new ConflictException("رسید قبلی این سفارش هنوز در انتظار بررسی است.");
        const created = await tx.storefrontPaymentAttempt.create({ data: {
          businessId: order.businessId, branchId: order.branchId, orderId: order.id, cardId: card.id,
          cardSnapshot: { id: card.id, bankName: card.bankName, holderName: card.holderName, last4: card.cardLast4, label: card.label, instructions: card.instructions },
          submittedAmountRial: submitted, customerTransactionReference: dto.customerTransactionReference?.trim() || null,
          submissionNote: dto.note?.trim() || null, transferredAt: dto.transferredAt ? new Date(dto.transferredAt) : null,
          status: "UNDER_REVIEW", receipt: { create: { storageKey, mimeType: prepared.mimeType, bytes: BigInt(prepared.bytes.byteLength), checksum: prepared.checksum } },
        } });
        const extendedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        await tx.storefrontOrder.update({ where: { id: order.id }, data: { paymentStatus: "UNDER_REVIEW", reservationExpiresAt: extendedUntil } });
        await tx.storefrontReservation.updateMany({ where: { orderId: order.id, releasedAt: null }, data: { expiresAt: extendedUntil } });
        await tx.auditEvent.create({ data: { businessId: order.businessId, actorId: null, action: "storefront.receipt.submitted", entityType: "storefront_payment_attempt", entityId: created.id, requestId: "public", afterJson: { orderId: order.id, branchId: order.branchId, mimeType: prepared.mimeType, bytes: prepared.bytes.byteLength } } });
        await tx.storefrontOrderEvent.create({ data: { businessId: order.businessId, branchId: order.branchId, orderId: order.id, previousStatus: "ACCEPTED", newStatus: "ACCEPTED", actorType: "CUSTOMER", customerMessage: "رسید دریافت شد و در انتظار بررسی فروشگاه است؛ ارسال رسید به معنی تأیید پرداخت نیست." } });
        return created;
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
      return { id: attempt.id, status: attempt.status, message: "رسید دریافت شد و در انتظار بررسی فروشگاه است؛ ارسال رسید به معنی تأیید پرداخت نیست." };
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      if (isSerializationConflict(error)) throw new ConflictException("وضعیت سفارش هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.");
      if (isUnique(error)) throw new ConflictException("این فایل رسید هم‌زمان برای سفارش دیگری ثبت شده است.");
      throw error;
    }
  }

  async orders(user: AuthenticatedUser, requestedStatus?: string, cursor?: string, requestedLimit?: string) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"]);
    const limit = pageLimit(requestedLimit, 20, 50);
    const statuses = ["SUBMITTED", "ACCEPTED", "REJECTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED", "RETURNED"];
    if (requestedStatus && !statuses.includes(requestedStatus)) throw new BadRequestException("فیلتر وضعیت سفارش معتبر نیست.");
    if (cursor && !(await this.prisma.storefrontOrder.findFirst({ where: { ...scope, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحهٔ سفارش برای این شعبه معتبر نیست.");
    const rows = await this.prisma.storefrontOrder.findMany({
      where: { ...scope, ...(requestedStatus ? { status: requestedStatus as never } : {}) },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { items: { select: { titleSnapshot: true, quantity: true, lineTotalRial: true } }, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, submittedAmountRial: true, createdAt: true, rejectionReason: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    return { ...page, items: page.items.map((row) => ({
      id: row.id, publicCode: row.publicCode, status: row.status, paymentStatus: row.paymentStatus,
      customerName: row.customerName, createdAt: row.createdAt.toISOString(), deliveryMethod: row.deliveryMethod,
      itemCount: row.items.length, totalRial: row.totalRial.toString(),
      lastReceipt: row.paymentAttempts[0] ? { status: row.paymentAttempts[0].status, submittedAmountRial: row.paymentAttempts[0].submittedAmountRial.toString(), createdAt: row.paymentAttempts[0].createdAt.toISOString(), rejectionReason: row.paymentAttempts[0].rejectionReason } : null,
    })) };
  }

  async orderDetail(user: AuthenticatedUser, orderId: string) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"]);
    const row = await this.prisma.storefrontOrder.findFirst({ where: { ...scope, id: orderId }, include: adminOrderInclude });
    if (!row) throw new NotFoundException("سفارش فروشگاه پیدا نشد.");
    return this.adminOrderDto(row, user.role ?? "VIEWER");
  }

  async downloadReceipt(user: AuthenticatedUser, orderId: string, attemptId: string) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "ACCOUNTANT"]);
    const receipt = await this.prisma.storefrontReceipt.findFirst({ where: { paymentAttemptId: attemptId, paymentAttempt: { orderId, ...scope } } });
    if (!receipt) throw new NotFoundException("رسید سفارش پیدا نشد.");
    return { bytes: await this.storage.read(receipt.storageKey), mimeType: receipt.mimeType };
  }

  async acceptOrder(user: AuthenticatedUser, orderId: string, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER"]);
    const now = new Date(); const expiresAt = new Date(now.getTime() + 45 * 60 * 1000);
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`storefront-order:${scope.businessId}:${scope.branchId}:${orderId}`}, 0))`;
        const order = await tx.storefrontOrder.findFirst({ where: { id: orderId, ...scope }, include: { items: true, business: { select: { inventoryEnabled: true } } } });
        if (!order) throw new NotFoundException("سفارش فروشگاه پیدا نشد.");
        if (order.status !== "SUBMITTED") throw new ConflictException("فقط سفارش جدید را می‌توان پذیرفت.");
        const activeCardCount = await tx.storePaymentCard.count({ where: { ...scope, isActive: true, financeAccount: { isActive: true, kind: "BANK" } } });
        if (!activeCardCount) throw new ConflictException("پیش از پذیرش سفارش، مالک باید یک کارت مقصد فعال به حساب بانکی فعال همین شعبه وصل کند.");
        const products = order.business.inventoryEnabled ? await tx.product.findMany({ where: { id: { in: order.items.map((item) => item.productId!).filter(Boolean) }, businessId: scope.businessId }, select: { id: true, kind: true, trackInventory: true, balances: { where: { branchId: scope.branchId }, select: { quantityOnHand: true } } } }) : [];
        const productMap = new Map(products.map((product) => [product.id, product]));
        const needed = new Map<string, bigint>();
        for (const item of order.items) {
          const product = item.productId ? productMap.get(item.productId) : undefined;
          if (!product || product.kind !== "STOCK" || !product.trackInventory) continue;
          needed.set(product.id, (needed.get(product.id) ?? 0n) + quantityMilli(item.quantity.toString()));
        }
        for (const [productId, quantity] of [...needed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`storefront-stock:${scope.businessId}:${scope.branchId}:${productId}`}, 0))`;
          const balance = productMap.get(productId)?.balances[0]?.quantityOnHand.toString() ?? "0";
          const available = await this.availableStock(tx, scope.businessId, scope.branchId, productId, balance, now);
          if (available < quantity) throw new ConflictException("موجودی آزاد برای این سفارش کافی نیست؛ سفارش را رد کنید یا موجودی را اصلاح کنید.");
          await tx.storefrontReservation.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId: order.id, productId, quantity: new Prisma.Decimal(quantityText(quantity)), expiresAt } });
        }
        const updated = await tx.storefrontOrder.update({ where: { id: order.id }, data: { status: "ACCEPTED", paymentStatus: "UNPAID", acceptedAt: now, paymentDueAt: expiresAt, reservationExpiresAt: expiresAt } });
        await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId: order.id, previousStatus: "SUBMITTED", newStatus: "ACCEPTED", actorId: user.id, actorType: "STAFF", customerMessage: "فروشگاه سفارش را پذیرفت. مبلغ و کارت مقصد را در پیگیری سفارش ببینید." } });
        await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.order.accepted", entityType: "storefront_order", entityId: order.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, publicCode: order.publicCode, totalRial: order.totalRial.toString(), paymentDueAt: expiresAt.toISOString(), reservedProducts: needed.size } } });
        return updated;
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
      return { id: saved.id, status: saved.status, paymentStatus: saved.paymentStatus, paymentDueAt: saved.paymentDueAt?.toISOString() ?? null };
    } catch (error) {
      if (isUnique(error)) throw new ConflictException("این سفارش قبلاً برای موجودی رزرو شده است؛ وضعیت سفارش را تازه کنید.");
      if (isSerializationConflict(error)) throw new ConflictException("موجودی هم‌زمان تغییر کرده است؛ سفارش را تازه کنید.");
      throw error;
    }
  }

  async rejectOrder(user: AuthenticatedUser, orderId: string, dto: RejectStorefrontOrderDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER"]);
    const order = await this.prisma.storefrontOrder.findFirst({ where: { id: orderId, ...scope } });
    if (!order) throw new NotFoundException("سفارش فروشگاه پیدا نشد.");
    if (order.status !== "SUBMITTED") throw new ConflictException("فقط سفارش جدید را می‌توان رد کرد.");
    const reason = dto.reason.trim();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.storefrontOrder.updateMany({ where: { id: order.id, ...scope, status: "SUBMITTED" }, data: { status: "REJECTED" } });
      if (changed.count !== 1) throw new ConflictException("وضعیت سفارش هم‌زمان تغییر کرده است.");
      await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId: order.id, previousStatus: "SUBMITTED", newStatus: "REJECTED", actorId: user.id, actorType: "STAFF", reason, customerMessage: reason } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.order.rejected", entityType: "storefront_order", entityId: order.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, publicCode: order.publicCode, reason } } });
    });
    return { id: order.id, status: "REJECTED" };
  }

  async verifyPayment(user: AuthenticatedUser, orderId: string, attemptId: string, dto: VerifyStorefrontPaymentDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER"]);
    const amount = parseMoney(dto.verifiedAmountRial, "مبلغ تأییدشده");
    if (amount <= 0n) throw new BadRequestException("مبلغ تأییدشده باید از صفر بیشتر باشد.");
    const reference = dto.transactionReference.trim();
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`storefront-order:${scope.businessId}:${scope.branchId}:${orderId}`}, 0))`;
      const order = await tx.storefrontOrder.findFirst({ where: { id: orderId, ...scope }, include: { items: true } });
      const attempt = await tx.storefrontPaymentAttempt.findFirst({ where: { id: attemptId, orderId, ...scope }, include: { card: { select: { financeAccountId: true } } } });
      if (!order || !attempt) throw new NotFoundException("سفارش یا رسید پیدا نشد.");
      if (order.status !== "ACCEPTED" || attempt.status !== "UNDER_REVIEW") throw new ConflictException("این رسید دیگر در صف بررسی نیست.");
      const duplicate = await tx.storefrontPaymentAttempt.findFirst({ where: { businessId: scope.businessId, transactionReference: reference, id: { not: attempt.id } }, select: { id: true } });
      if (duplicate) throw new ConflictException("این شمارهٔ پیگیری بانکی قبلاً برای سفارش دیگری ثبت شده است.");
      const verified = await tx.storefrontPaymentAttempt.aggregate({ where: { orderId, status: { in: ["VERIFIED", "PARTIALLY_VERIFIED"] } }, _sum: { verifiedAmountRial: true } });
      const received = verified._sum.verifiedAmountRial ?? 0n;
      const remaining = order.totalRial - received;
      if (amount > remaining) {
        const updatedAttempt = await tx.storefrontPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "OVERPAID_REVIEW", verifiedAmountRial: amount, transactionReference: reference, reviewerId: user.id, reviewedAt: now, rejectionReason: "مبلغ تراکنش از ماندهٔ سفارش بیشتر است و تا رسیدگی دستی در حسابداری ثبت نشده است." } });
        await tx.storefrontOrder.update({ where: { id: order.id }, data: { paymentStatus: "OVERPAID_REVIEW" } });
        await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.payment.overpaid_review", entityType: "storefront_payment_attempt", entityId: attempt.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, orderId, submittedAmountRial: attempt.submittedAmountRial.toString(), verifiedAmountRial: amount.toString(), remainingRial: remaining.toString() } } });
        await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId, previousStatus: order.status, newStatus: order.status, actorId: user.id, actorType: "STAFF", customerMessage: "مبلغ واریزی از ماندهٔ سفارش بیشتر است و برای بررسی دستی به فروشگاه ارجاع شد." } });
        return { status: updatedAttempt.status, paymentStatus: "OVERPAID_REVIEW", verifiedAmountRial: received.toString(), remainingRial: remaining.toString(), needsManualResolution: true };
      }
      const accountId = attempt.card?.financeAccountId;
      if (!accountId) throw new ConflictException("حساب مالی کارت مقصد برای ثبت وجه پیدا نشد.");
      const party = await this.customerParty(tx, order.businessId, order.customerName, order.customerPhone);
      const date = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
      const posting = await this.accounting.postStorefrontReceipt(tx, { businessId: scope.businessId, branchId: scope.branchId, actorId: user.id, paymentAttemptId: attempt.id, orderCode: order.publicCode, amountRial: amount, financeAccountId: accountId, partyId: party.id, reference, date });
      const totalVerified = received + amount;
      const status = totalVerified === order.totalRial ? "VERIFIED" : "PARTIALLY_VERIFIED";
      await tx.storefrontPaymentAttempt.update({ where: { id: attempt.id }, data: { status: totalVerified === order.totalRial ? "VERIFIED" : "PARTIALLY_VERIFIED", verifiedAmountRial: amount, transactionReference: reference, reviewerId: user.id, reviewedAt: now, cashTransactionId: posting.cashTransactionId } });
      const pending = await tx.storefrontPaymentAttempt.count({ where: { orderId, status: "UNDER_REVIEW", id: { not: attempt.id } } });
      const paymentStatus = totalVerified === order.totalRial ? "VERIFIED" : pending ? "UNDER_REVIEW" : "PARTIALLY_VERIFIED";
      const extendUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      await tx.storefrontOrder.update({ where: { id: order.id }, data: { customerPartyId: party.id, paymentStatus, reservationExpiresAt: extendUntil } });
      await tx.storefrontReservation.updateMany({ where: { orderId, releasedAt: null }, data: { expiresAt: extendUntil } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.payment.verified", entityType: "storefront_payment_attempt", entityId: attempt.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, orderId, amountRial: amount.toString(), paymentStatus, cashTransactionId: posting.cashTransactionId, journalEntryId: posting.journalEntryId } } });
      await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId, previousStatus: order.status, newStatus: order.status, actorId: user.id, actorType: "STAFF", customerMessage: status === "VERIFIED" ? "پرداخت سفارش با گردش بانکی تطبیق و تأیید شد." : "بخشی از مبلغ سفارش با گردش بانکی تطبیق و تأیید شد." } });
      return { status, paymentStatus, verifiedAmountRial: totalVerified.toString(), remainingRial: (order.totalRial - totalVerified).toString(), needsManualResolution: false };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
    return result;
  }

  async rejectPayment(user: AuthenticatedUser, orderId: string, attemptId: string, dto: RejectStorefrontPaymentDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER"]);
    const reason = dto.reason.trim(); const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`storefront-order:${scope.businessId}:${scope.branchId}:${orderId}`}, 0))`;
      const order = await tx.storefrontOrder.findFirst({ where: { id: orderId, ...scope } });
      const attempt = await tx.storefrontPaymentAttempt.findFirst({ where: { id: attemptId, orderId, ...scope } });
      if (!order || !attempt) throw new NotFoundException("سفارش یا رسید پیدا نشد.");
      if (attempt.status !== "UNDER_REVIEW") throw new ConflictException("این رسید دیگر در صف بررسی نیست.");
      await tx.storefrontPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "REJECTED", rejectionReason: reason, reviewerId: user.id, reviewedAt: now } });
      const verified = await tx.storefrontPaymentAttempt.aggregate({ where: { orderId, status: { in: ["VERIFIED", "PARTIALLY_VERIFIED"] } }, _sum: { verifiedAmountRial: true } });
      const verifiedAmount = verified._sum.verifiedAmountRial ?? 0n;
      const pending = await tx.storefrontPaymentAttempt.count({ where: { orderId, status: "UNDER_REVIEW", id: { not: attempt.id } } });
      const expired = Boolean(order.paymentDueAt && order.paymentDueAt <= now && !pending && verifiedAmount < order.totalRial);
      const nextStatus = expired ? "EXPIRED" : order.status;
      const nextPaymentStatus = pending ? "UNDER_REVIEW" : verifiedAmount > 0n ? "PARTIALLY_VERIFIED" : "UNPAID";
      if (expired || order.paymentStatus !== nextPaymentStatus) await tx.storefrontOrder.update({ where: { id: order.id }, data: { status: nextStatus, paymentStatus: nextPaymentStatus } });
      if (expired) await tx.storefrontReservation.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now } });
      await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId, previousStatus: expired ? order.status : null, newStatus: expired ? "EXPIRED" : order.status, actorId: user.id, actorType: "STAFF", reason, customerMessage: expired ? `رسید رد شد: ${reason} مهلت پرداخت نیز پایان یافته است.` : `رسید رد شد: ${reason}` } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.payment.rejected", entityType: "storefront_payment_attempt", entityId: attempt.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, orderId, reason, expired } } });
      return { status: "REJECTED", orderStatus: nextStatus, paymentStatus: nextPaymentStatus };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
    return result;
  }

  async resolveOverpayment(user: AuthenticatedUser, orderId: string, attemptId: string, dto: ResolveStorefrontOverpaymentDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER"]);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`storefront-order:${scope.businessId}:${scope.branchId}:${orderId}`}, 0))`;
      const order = await tx.storefrontOrder.findFirst({ where: { id: orderId, ...scope }, include: { items: true } });
      const attempt = await tx.storefrontPaymentAttempt.findFirst({ where: { id: attemptId, orderId, ...scope }, include: { card: { select: { financeAccountId: true } } } });
      if (!order || !attempt) throw new NotFoundException("سفارش یا رسید پیدا نشد.");
      if (attempt.status !== "OVERPAID_REVIEW" || !attempt.verifiedAmountRial || !attempt.transactionReference || attempt.cashTransactionId) throw new ConflictException("این اضافه‌پرداخت در وضعیت قابل ثبت نیست.");
      if (order.status !== "ACCEPTED" || order.paymentStatus !== "OVERPAID_REVIEW") throw new ConflictException("وضعیت پرداخت سفارش تغییر کرده است.");
      const prior = await tx.storefrontPaymentAttempt.aggregate({ where: { orderId, id: { not: attempt.id }, status: { in: ["VERIFIED", "PARTIALLY_VERIFIED"] } }, _sum: { verifiedAmountRial: true } });
      const previouslyVerified = prior._sum.verifiedAmountRial ?? 0n;
      const remaining = order.totalRial - previouslyVerified;
      if (remaining <= 0n || attempt.verifiedAmountRial <= remaining) throw new ConflictException("مبلغ این رسید دیگر اضافه‌پرداخت محسوب نمی‌شود؛ وضعیت سفارش را دوباره بررسی کنید.");
      const accountId = attempt.card?.financeAccountId;
      if (!accountId) throw new ConflictException("حساب بانکی کارت مقصد پیدا نشد.");
      const party = await this.customerParty(tx, order.businessId, order.customerName, order.customerPhone);
      const date = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
      const posting = await this.accounting.postStorefrontReceipt(tx, { businessId: scope.businessId, branchId: scope.branchId, actorId: user.id, paymentAttemptId: attempt.id, orderCode: order.publicCode, amountRial: attempt.verifiedAmountRial, financeAccountId: accountId, partyId: party.id, reference: attempt.transactionReference, date });
      await tx.storefrontPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "VERIFIED", reviewerId: user.id, reviewedAt: now, cashTransactionId: posting.cashTransactionId, rejectionReason: null } });
      await tx.storefrontOrder.update({ where: { id: order.id }, data: { customerPartyId: party.id, paymentStatus: "VERIFIED", reservationExpiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) } });
      await tx.storefrontReservation.updateMany({ where: { orderId, releasedAt: null }, data: { expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) } });
      await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId, previousStatus: order.status, newStatus: order.status, actorId: user.id, actorType: "STAFF", reason: dto.note?.trim() || null, customerMessage: `واریز واقعی پس از بررسی دستی ثبت شد؛ ${ (attempt.verifiedAmountRial - remaining).toString() } ریال اضافه به‌عنوان اعتبار مشتری در حساب مالی باقی ماند. بازپرداخت این مبلغ ثبت نشده است.` } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: "storefront.payment.overpayment_recorded_as_credit", entityType: "storefront_payment_attempt", entityId: attempt.id, requestId: request.requestId ?? "unknown", afterJson: { branchId: scope.branchId, orderId, amountRial: attempt.verifiedAmountRial.toString(), appliedToOrderRial: remaining.toString(), customerCreditRial: (attempt.verifiedAmountRial - remaining).toString(), cashTransactionId: posting.cashTransactionId, journalEntryId: posting.journalEntryId } } });
      return { status: "VERIFIED", paymentStatus: "VERIFIED", verifiedAmountRial: (previouslyVerified + attempt.verifiedAmountRial).toString(), appliedToOrderRial: remaining.toString(), customerCreditRial: (attempt.verifiedAmountRial - remaining).toString(), refundRecorded: false };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
  }

  async transitionOrder(user: AuthenticatedUser, orderId: string, dto: TransitionStorefrontOrderDto, request: AppRequest) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER", "CASHIER"]);
    const order = await this.prisma.storefrontOrder.findFirst({ where: { id: orderId, ...scope } });
    if (!order) throw new NotFoundException("سفارش فروشگاه پیدا نشد.");
    assertAllowedTransition(order.status, dto.status);
    if (["PREPARING", "READY", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED"].includes(dto.status) && order.paymentStatus !== "VERIFIED") throw new ConflictException("تا تأیید کامل وجه، سفارش برای آماده‌سازی یا تحویل مجاز نیست.");
    if (dto.status === "OUT_FOR_DELIVERY" && order.deliveryMethod !== "LOCAL_DELIVERY") throw new BadRequestException("سفارش تحویل حضوری برای ارسال محلی تنظیم نشده است.");
    if (dto.status === "READY_FOR_PICKUP" && order.deliveryMethod !== "PICKUP") throw new BadRequestException("این سفارش برای ارسال محلی ثبت شده است.");
    if (dto.status === "CANCELLED") {
      const verified = await this.prisma.storefrontPaymentAttempt.aggregate({ where: { orderId, status: { in: ["VERIFIED", "PARTIALLY_VERIFIED"] } }, _sum: { verifiedAmountRial: true } });
      if ((verified._sum.verifiedAmountRial ?? 0n) > 0n) throw new ConflictException("سفارش دارای وجه تأییدشده است؛ ابتدا بازپرداخت واقعی را از مسیر مالی ثبت کنید.");
      const unresolved = await this.prisma.storefrontPaymentAttempt.count({ where: { orderId, status: { in: ["UNDER_REVIEW", "OVERPAID_REVIEW"] } } });
      if (unresolved) throw new ConflictException("برای لغو، ابتدا رسیدهای در حال بررسی را تعیین تکلیف کنید.");
      if (!dto.reason?.trim()) throw new BadRequestException("دلیل لغو سفارش را وارد کنید.");
    }
    if (dto.status === "COMPLETED") await this.postCompletedSale(user, orderId, request);
    const now = new Date();
    const message = dto.customerMessage?.trim() || this.defaultCustomerMessage(dto.status);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.storefrontOrder.updateMany({ where: { id: order.id, ...scope, status: order.status }, data: { status: dto.status, ...(dto.status === "COMPLETED" ? { completedAt: now } : {}), ...(dto.status === "PREPARING" || dto.status === "READY" || dto.status === "READY_FOR_PICKUP" || dto.status === "OUT_FOR_DELIVERY" ? { reservationExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } : {}) } });
      if (changed.count !== 1) {
        const current = await tx.storefrontOrder.findFirst({ where: { id: order.id, ...scope }, select: { status: true } });
        if (current?.status === dto.status) return { status: current.status };
        throw new ConflictException("وضعیت سفارش هم‌زمان تغییر کرده است.");
      }
      if (dto.status === "PREPARING" || dto.status === "READY" || dto.status === "READY_FOR_PICKUP" || dto.status === "OUT_FOR_DELIVERY") await tx.storefrontReservation.updateMany({ where: { orderId, releasedAt: null }, data: { expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } });
      if (dto.status === "CANCELLED") await tx.storefrontReservation.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now } });
      await tx.storefrontOrderEvent.create({ data: { businessId: scope.businessId, branchId: scope.branchId, orderId, previousStatus: order.status, newStatus: dto.status, actorId: user.id, actorType: "STAFF", reason: dto.reason?.trim() || null, customerMessage: message } });
      await tx.auditEvent.create({ data: { businessId: scope.businessId, actorId: user.id, action: `storefront.order.${dto.status.toLowerCase()}`, entityType: "storefront_order", entityId: orderId, requestId: request.requestId ?? "unknown", beforeJson: { status: order.status }, afterJson: { status: dto.status, branchId: scope.branchId, publicCode: order.publicCode } } });
      return { status: dto.status };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
    return { id: order.id, status: updated.status };
  }

  async analytics(user: AuthenticatedUser, requestedDays?: string) {
    const scope = this.scope(user); this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const days = requestedDays === undefined ? 7 : Number(requestedDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new BadRequestException("بازهٔ گزارش باید از ۱ تا ۹۰ روز باشد.");
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [orders, pendingAttempts, verifiedAttempts, postedSales] = await Promise.all([
      this.prisma.storefrontOrder.groupBy({ by: ["status"], where: { ...scope, createdAt: { gte: from } }, _count: { _all: true }, _sum: { totalRial: true } }),
      this.prisma.storefrontPaymentAttempt.count({ where: { ...scope, status: "UNDER_REVIEW", createdAt: { gte: from } } }),
      this.prisma.storefrontPaymentAttempt.aggregate({ where: { ...scope, status: { in: ["VERIFIED", "PARTIALLY_VERIFIED"] }, reviewedAt: { gte: from } }, _sum: { verifiedAmountRial: true }, _count: { _all: true } }),
      this.prisma.salesInvoice.aggregate({ where: { ...scope, storefrontOrderId: { not: null }, status: "POSTED", postedAt: { gte: from } }, _sum: { totalRial: true }, _count: { _all: true } }),
    ]);
    return { days, from: from.toISOString(), orderCounts: Object.fromEntries(orders.map((row) => [row.status, row._count._all])), submittedOrderRial: orders.reduce((sum, row) => sum + (row._sum.totalRial ?? 0n), 0n).toString(), receiptsWaitingReview: pendingAttempts, verifiedPaymentCount: verifiedAttempts._count._all, verifiedPaymentRial: (verifiedAttempts._sum.verifiedAmountRial ?? 0n).toString(), postedSalesCount: postedSales._count._all, postedSalesRial: (postedSales._sum.totalRial ?? 0n).toString() };
  }

  async expireOverdueOrders() {
    const now = new Date();
    const rows = await this.prisma.storefrontOrder.findMany({ where: { status: "ACCEPTED", paymentDueAt: { lte: now }, paymentStatus: { in: ["UNPAID", "PARTIALLY_VERIFIED"] } }, select: { id: true, businessId: true, branchId: true }, take: 500 });
    for (const row of rows) await this.expireOneOrder(row.id, row.businessId, row.branchId, now);
    await this.prisma.storefrontRateLimitBucket.deleteMany({ where: { bucketStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
    return rows.length;
  }

  private settingsDto(row: Storefront) {
    return { settings: {
      id: row.id, slug: row.slug, status: row.status, publicName: row.publicName, description: row.description,
      phone: row.phone, address: row.address, showAddress: row.showAddress, acceptsPickup: row.acceptsPickup,
      acceptsLocalDelivery: row.acceptsLocalDelivery, deliveryFeeRial: row.deliveryFeeRial.toString(),
      showExactStock: row.showExactStock, preparationMinutes: row.preparationMinutes,
      paymentInstructions: row.paymentInstructions, cancellationPolicy: row.cancellationPolicy,
      publicUrl: `/s/${row.slug}`,
    } };
  }

  private adminOrderDto(row: AdminOrder, role: string) {
    const verifiedAmount = row.paymentAttempts.filter((attempt) => ["VERIFIED", "PARTIALLY_VERIFIED"].includes(attempt.status)).reduce((sum, attempt) => sum + (attempt.verifiedAmountRial ?? 0n), 0n);
    return {
      id: row.id, publicCode: row.publicCode, status: row.status, paymentStatus: row.paymentStatus,
      customer: { name: row.customerName, phone: row.customerPhone, address: row.deliveryAddress, note: row.customerNote },
      deliveryMethod: row.deliveryMethod, createdAt: row.createdAt.toISOString(), acceptedAt: row.acceptedAt?.toISOString() ?? null,
      paymentDueAt: row.paymentDueAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
      subtotalRial: row.subtotalRial.toString(), taxRial: row.taxRial.toString(), deliveryFeeRial: row.deliveryFeeRial.toString(), totalRial: row.totalRial.toString(), verifiedAmountRial: verifiedAmount.toString(),
      items: row.items.map((item) => ({ id: item.id, title: item.titleSnapshot, sku: item.skuSnapshot, quantity: item.quantity.toString(), unitCode: item.unitCodeSnapshot, unitPriceRial: item.unitPriceRial.toString(), taxRateBasisPoints: item.taxRateBasisPoints, taxRial: item.taxRial.toString(), lineTotalRial: item.lineTotalRial.toString() })),
      paymentAttempts: role === "CASHIER" ? [] : row.paymentAttempts.map((attempt) => ({
        id: attempt.id, status: attempt.status, submittedAmountRial: attempt.submittedAmountRial.toString(),
        verifiedAmountRial: attempt.verifiedAmountRial?.toString() ?? null,
        customerTransactionReference: ["OWNER", "ACCOUNTANT"].includes(role) ? attempt.customerTransactionReference : null, transactionReference: ["OWNER", "ACCOUNTANT"].includes(role) ? attempt.transactionReference : null,
        transferredAt: attempt.transferredAt?.toISOString() ?? null, submittedAt: attempt.createdAt.toISOString(),
        reviewedAt: attempt.reviewedAt?.toISOString() ?? null, rejectionReason: attempt.rejectionReason,
        note: attempt.submissionNote, card: publicCardSnapshot(attempt.cardSnapshot),
        receipt: attempt.receipt && ["OWNER", "ACCOUNTANT"].includes(role) ? { id: attempt.receipt.id, mimeType: attempt.receipt.mimeType, bytes: attempt.receipt.bytes.toString(), uploadedAt: attempt.receipt.uploadedAt.toISOString(), downloadPath: `/storefront/orders/${row.id}/receipts/${attempt.id}` } : null,
        cashTransaction: attempt.cashTransaction ? { id: attempt.cashTransaction.id, amountRial: attempt.cashTransaction.amountRial.toString(), reference: attempt.cashTransaction.reference } : null,
      })),
      timeline: row.events.map((event) => ({ previousStatus: event.previousStatus, status: event.newStatus, actorType: event.actorType, reason: event.reason, message: event.customerMessage, at: event.createdAt.toISOString() })),
      salesInvoice: row.salesInvoice ? { id: row.salesInvoice.id, invoiceNo: row.salesInvoice.invoiceNo, status: row.salesInvoice.status } : null,
    };
  }

  private async findPublicStore(slug: string, mustBePublished: boolean) {
    const normalized = normalizeStoreSlug(slug);
    const row = await this.prisma.storefront.findUnique({ where: { slug: normalized } });
    if (!row || row.status === "DRAFT") throw new NotFoundException("فروشگاه پیدا نشد.");
    const branch = await this.prisma.branch.findFirst({ where: { id: row.branchId, businessId: row.businessId, isActive: true }, select: { id: true } });
    if (!branch) throw new NotFoundException("فروشگاه پیدا نشد.");
    if (mustBePublished && row.status !== "PUBLISHED") throw new ConflictException("این شعبه فعلاً سفارش جدید نمی‌پذیرد.");
    return row;
  }

  private async newOrdersAllowed(businessId: string, branchId: string) {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<Array<{ rollout_mode: string | null; grace_ends_at: Date | null; suspended_at: Date | null; active_period: boolean; has_history: boolean; latest_end: Date | null }>>`
      SELECT rollout."mode"::text AS rollout_mode, rollout."legacy_grace_ends_at" AS grace_ends_at,
        s."suspended_at", entitlement."active_period", entitlement."has_history", entitlement."latest_end"
      FROM "branches" b
      LEFT JOIN "branch_subscriptions" s ON s."business_id" = b."business_id" AND s."branch_id" = b."id"
      LEFT JOIN "subscription_rollout_settings" rollout ON rollout."id" = 'global'
      LEFT JOIN LATERAL (
        SELECT COALESCE(BOOL_OR(p."starts_at" <= ${now} AND p."ends_at" > ${now}), false) AS active_period,
          COUNT(*) > 0 AS has_history, MAX(p."ends_at") AS latest_end
        FROM "subscription_periods" p
        WHERE p."business_id" = b."business_id" AND p."branch_id" = b."id" AND p."revoked_at" IS NULL
      ) entitlement ON true
      WHERE b."id" = ${branchId}::uuid AND b."business_id" = ${businessId}::uuid AND b."is_active" = true LIMIT 1
    `;
    const row = rows[0];
    if (!row) return false;
    return !entitlementDenial({ rolloutMode: row.rollout_mode === "ENFORCE" ? "ENFORCE" : "OBSERVE", graceEndsAt: row.grace_ends_at, suspended: Boolean(row.suspended_at), active: row.active_period, hasHistory: row.has_history, latestEnd: row.latest_end }, now);
  }

  private async requireStore(scope: Scope) {
    const store = await this.prisma.storefront.findFirst({ where: scope });
    if (!store) throw new ConflictException("ابتدا تنظیمات ویترین همین شعبه را ذخیره کنید.");
    return store;
  }

  private async checkPublicRateLimit(operation: string, ipAddress: string | undefined, maximum: number, intervalMs = 60_000) {
    const now = new Date();
    const bucketStart = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
    const fingerprint = hash(`storefront-public:${operation}:${ipAddress || "unknown"}`);
    const rows = await this.prisma.$queryRaw<Array<{ request_count: number }>>`
      INSERT INTO "storefront_rate_limit_buckets" ("fingerprint", "bucket_start", "request_count")
      VALUES (${fingerprint}, ${bucketStart}, 1)
      ON CONFLICT ("fingerprint", "bucket_start") DO UPDATE
      SET "request_count" = "storefront_rate_limit_buckets"."request_count" + 1
      RETURNING "request_count"
    `;
    if ((rows[0]?.request_count ?? maximum + 1) > maximum) throw new HttpException("درخواست‌های پیاپی بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.", HttpStatus.TOO_MANY_REQUESTS);
  }

  private scope(user: AuthenticatedUser): Scope {
    if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید.");
    return { businessId: user.businessId, branchId: user.branchId };
  }

  private requireRole(user: AuthenticatedUser, roles: string[]) {
    if (!user.role || !roles.includes(user.role)) throw new ForbiddenException("اجازهٔ انجام این عملیات فروشگاه را ندارید.");
  }

  private async availableStock(tx: Prisma.TransactionClient, businessId: string, branchId: string, productId: string, onHandText: string, now: Date) {
    const reserved = await tx.storefrontReservation.aggregate({ where: { businessId, branchId, productId, releasedAt: null, expiresAt: { gt: now } }, _sum: { quantity: true } });
    const onHand = quantityMilliOrZero(onHandText);
    const reservedQuantity = quantityMilliOrZero(reserved._sum.quantity?.toString() ?? "0");
    return onHand > reservedQuantity ? onHand - reservedQuantity : 0n;
  }

  private async customerParty(tx: Prisma.TransactionClient, businessId: string, name: string, phone: string) {
    const existing = await tx.party.findFirst({ where: { businessId, phone, archivedAt: null, type: { in: ["CUSTOMER", "BOTH"] } } });
    if (existing) return existing;
    return tx.party.create({ data: { businessId, type: "CUSTOMER", name: name.trim(), normalizedName: normalizePersianSearch(name), phone } });
  }

  private async findOrderByTrackingToken(token: string) {
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new NotFoundException("سفارش پیدا نشد؛ پیوند پیگیری را بررسی کنید.");
    const order = await this.prisma.storefrontOrder.findFirst({ where: { trackingTokenHash: this.trackingHash(token) } });
    if (!order) throw new NotFoundException("سفارش پیدا نشد؛ پیوند پیگیری را بررسی کنید.");
    return order;
  }

  private trackingHash(token: string) { return hash(token); }

  private createdOrderResult(order: { id: string; businessId: string; publicCode: string; requestHash: string; totalRial: bigint; status: string }, requestHash: string) {
    if (order.requestHash !== requestHash) throw new ConflictException("این کلید سفارش قبلاً برای اطلاعات دیگری استفاده شده است.");
    const trackingToken = trackingTokenForOrder(order.id, order.businessId);
    return { id: order.id, publicCode: order.publicCode, status: order.status, totalRial: order.totalRial.toString(), trackingToken, trackingPath: `/order/${trackingToken}` };
  }

  private defaultCustomerMessage(status: TransitionStorefrontOrderDto["status"]) {
    const messages: Record<TransitionStorefrontOrderDto["status"], string> = {
      PREPARING: "آماده‌سازی سفارش آغاز شد.", READY: "سفارش آمادهٔ دریافت است.",
      OUT_FOR_DELIVERY: "سفارش برای ارسال تحویل پیک شد.", READY_FOR_PICKUP: "سفارش برای تحویل حضوری آماده است.",
      COMPLETED: "تحویل سفارش ثبت شد.", CANCELLED: "سفارش لغو شد.",
    };
    return messages[status];
  }

  private async postCompletedSale(user: AuthenticatedUser, orderId: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    let order = await this.prisma.storefrontOrder.findFirst({ where: { id: orderId, businessId, branchId }, include: { items: true } });
    if (!order) throw new NotFoundException("سفارش فروشگاه پیدا نشد.");
    if (order.paymentStatus !== "VERIFIED" || !["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(order.status)) throw new ConflictException("فقط سفارش پرداخت‌شده و آمادهٔ تحویل را می‌توان تکمیل کرد.");
    let customerPartyId = order.customerPartyId;
    if (!customerPartyId) {
      const party = await this.prisma.$transaction(async (tx) => {
        const found = await this.customerParty(tx, businessId, order!.customerName, order!.customerPhone);
        await tx.storefrontOrder.updateMany({ where: { id: order!.id, businessId, branchId, customerPartyId: null }, data: { customerPartyId: found.id } });
        return found;
      }, { isolationLevel: "Serializable" });
      customerPartyId = party.id;
      order = await this.prisma.storefrontOrder.findFirst({ where: { id: orderId, businessId, branchId }, include: { items: true } });
      if (!order) throw new NotFoundException("سفارش فروشگاه پیدا نشد.");
    }
    const draft = await this.sales.createStorefrontDraft(user, orderId, request);
    if (draft.status === "DRAFT") {
      try { await this.sales.post(user, draft.id, {}, `storefront-post:${orderId}`, request); }
      catch (error) {
        const invoice = await this.prisma.salesInvoice.findFirst({ where: { businessId, branchId, storefrontOrderId: orderId }, select: { status: true } });
        if (invoice?.status !== "POSTED") throw error;
      }
    }
    const invoice = await this.prisma.salesInvoice.findFirst({ where: { businessId, branchId, storefrontOrderId: orderId, status: "POSTED" }, select: { id: true } });
    if (!invoice) throw new ConflictException("ثبت فروش سفارش در حسابداری کامل نشد؛ دوباره تلاش کنید.");
    await this.prisma.$transaction(async (tx) => {
      const attempts = await tx.storefrontPaymentAttempt.findMany({ where: { orderId, businessId, branchId, status: { in: ["VERIFIED", "PARTIALLY_VERIFIED"] }, cashTransactionId: { not: null } }, select: { cashTransactionId: true, verifiedAmountRial: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const posted = await tx.paymentAllocation.findMany({ where: { businessId, salesInvoiceId: invoice.id }, select: { cashTransactionId: true, amountRial: true } });
      const existingByCash = new Map(posted.map((row) => [row.cashTransactionId, row.amountRial]));
      let allocated = posted.reduce((sum, row) => sum + row.amountRial, 0n);
      const plan = paymentAllocationPlan(order!.totalRial, attempts.map((attempt) => attempt.verifiedAmountRial ?? 0n));
      for (const [index, attempt] of attempts.entries()) {
        if (!attempt.cashTransactionId || !attempt.verifiedAmountRial) continue;
        const allocationAmount = plan[index];
        const existing = existingByCash.get(attempt.cashTransactionId);
        if (existing !== undefined) {
          if (existing !== allocationAmount) throw new ConflictException("تخصیص وجه سفارش با دریافت ثبت‌شده سازگار نیست.");
          continue;
        }
        if (allocationAmount <= 0n) continue;
        await tx.paymentAllocation.create({ data: { businessId, cashTransactionId: attempt.cashTransactionId, salesInvoiceId: invoice.id, amountRial: allocationAmount } });
        allocated += allocationAmount;
      }
      if (plan.reduce((sum, amount) => sum + amount, 0n) !== order!.totalRial || allocated !== order!.totalRial) throw new ConflictException("مجموع دریافت‌های تخصیص‌یافته با فاکتور سفارش برابر نیست.");
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  private async expireOneOrder(orderId: string, businessId: string, branchId: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`storefront-order:${businessId}:${branchId}:${orderId}`}, 0))`;
      const order = await tx.storefrontOrder.findFirst({ where: { id: orderId, businessId, branchId, status: "ACCEPTED", paymentDueAt: { lte: now }, paymentStatus: { in: ["UNPAID", "PARTIALLY_VERIFIED"] } } });
      if (!order) return;
      const pending = await tx.storefrontPaymentAttempt.count({ where: { orderId, status: "UNDER_REVIEW" } });
      if (pending) return;
      const changed = await tx.storefrontOrder.updateMany({ where: { id: order.id, status: "ACCEPTED", paymentDueAt: { lte: now } }, data: { status: "EXPIRED" } });
      if (!changed.count) return;
      await tx.storefrontReservation.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now } });
      await tx.storefrontOrderEvent.create({ data: { businessId, branchId, orderId, previousStatus: "ACCEPTED", newStatus: "EXPIRED", actorType: "SYSTEM", customerMessage: "مهلت پرداخت سفارش پایان یافت و رزرو موجودی آزاد شد." } });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }
}
