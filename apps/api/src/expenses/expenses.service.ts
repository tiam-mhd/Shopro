import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService } from "../finance/accounting.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import type { CreateExpenseCategoryDto, CreateExpenseDto, PostExpenseDto, UpdateExpenseCategoryDto, VoidExpenseDto } from "./expenses.dto.js";
import { prepareExpenseAttachment } from "./attachment-files.js";
import { AttachmentStorageService } from "./attachment-storage.service.js";
import { createAttachmentDownloadGrant, verifyAttachmentDownloadGrant } from "./attachment-download-token.js";
import { lockAttachmentMutationDuringBackup } from "./attachment-backup-lock.js";
import { assertUuid } from "../common/uuid-param.pipe.js";

const money = (value: string) => { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); const result = BigInt(value); if (result <= 0n) throw new BadRequestException("مبلغ باید بزرگ‌تر از صفر باشد."); return result; };

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService, private readonly attachmentStorage: AttachmentStorageService) {}

  async list(user: AuthenticatedUser, cursor?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user);
    assertUuid(cursor, "نشانگر صفحه برای فهرست هزینه‌ها معتبر نیست.");
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit) : 200;
    const where = { businessId, branchId };
    if (cursor && !(await this.prisma.expense.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای فهرست هزینه‌ها معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.expense.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { category: { select: { name: true } }, payee: { select: { party: { select: { name: true } } } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: limit + (pageMode ? 1 : 0) });
    const mapped = rows.map((row) => ({ id: row.id, expenseNo: row.expenseNo, date: row.txnDate.toISOString().slice(0, 10), amountRial: row.amountRial.toString(), taxRial: row.taxRial.toString(), category: row.category.name, payee: row.payee?.party.name ?? null, status: row.status, note: row.note }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async get(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const row = await this.prisma.expense.findFirst({ where: { id, businessId, branchId }, include: { category: { select: { name: true } }, payee: { select: { party: { select: { name: true, phone: true, email: true, address: true } } } }, attachment: { select: { fileName: true, mimeType: true, bytes: true, createdAt: true } } } });
    if (!row) throw new NotFoundException("هزینه پیدا نشد.");
    return { id: row.id, expenseNo: row.expenseNo, date: row.txnDate.toISOString().slice(0, 10), amountRial: row.amountRial.toString(), taxRateBasisPoints: row.taxRateBasisPoints, taxRial: row.taxRial.toString(), categoryId: row.categoryId, category: row.category.name, payeeId: row.payeeId, payee: row.payee?.party ?? null, status: row.status, note: row.note, postedAt: row.postedAt?.toISOString() ?? null, canManageAttachment: this.canManageExpense(user), attachment: row.attachment ? { fileName: row.attachment.fileName, mimeType: row.attachment.mimeType, bytes: row.attachment.bytes.toString(), uploadedAt: row.attachment.createdAt.toISOString() } : null };
  }

  async uploadAttachment(user: AuthenticatedUser, id: string, file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.assertExpenseId(id);
    if (!this.canManageExpense(user)) throw new ForbiddenException("افزودن پیوست برای نقش شما مجاز نیست.");
    const prepared = prepareExpenseAttachment(file);
    const expense = await this.prisma.expense.findFirst({ where: { id, businessId, branchId }, select: { id: true, status: true, attachmentId: true } });
    if (!expense) throw new NotFoundException("هزینه پیدا نشد.");
    if (expense.status !== "DRAFT") throw new ConflictException("پس از ثبت نهایی هزینه نمی‌توان پیوست آن را تغییر داد.");
    if (expense.attachmentId) throw new ConflictException("برای این هزینه پیوستی ثبت شده است؛ ابتدا آن را بردارید.");

    const attachmentId = randomUUID();
    const storageKey = `${attachmentId}.${prepared.extension}`;
    await this.attachmentStorage.save(storageKey, prepared.bytes);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockAttachmentMutationDuringBackup(tx);
        const current = await tx.expense.findFirst({ where: { id, businessId, branchId }, select: { id: true, status: true, attachmentId: true } });
        if (!current) throw new NotFoundException("هزینه پیدا نشد.");
        if (current.status !== "DRAFT") throw new ConflictException("پس از ثبت نهایی هزینه نمی‌توان پیوست آن را تغییر داد.");
        if (current.attachmentId) throw new ConflictException("برای این هزینه پیوستی ثبت شده است؛ ابتدا آن را بردارید.");
        const attachment = await tx.attachment.create({ data: { id: attachmentId, businessId, storageKey, fileName: prepared.fileName, mimeType: prepared.mimeType, bytes: BigInt(prepared.bytes.byteLength), checksum: prepared.checksum, uploadedBy: user.id } });
        await tx.expense.update({ where: { id }, data: { attachmentId: attachment.id } });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.attachment.added", entityType: "expense", entityId: id, requestId: request.requestId ?? "unknown", afterJson: { mimeType: prepared.mimeType, bytes: String(prepared.bytes.byteLength), checksum: prepared.checksum } } });
        return { fileName: attachment.fileName, mimeType: attachment.mimeType, bytes: attachment.bytes.toString(), uploadedAt: attachment.createdAt.toISOString() };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      await this.attachmentStorage.remove(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async issueAttachmentDownloadToken(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    this.assertExpenseId(id);
    const expense = await this.prisma.expense.findFirst({ where: { id, businessId, branchId }, select: { attachment: { select: { id: true } } } });
    if (!expense?.attachment) throw new NotFoundException("پیوستی برای این هزینه ثبت نشده است.");
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) throw new ServiceUnavailableException("امضای امن دریافت فایل تنظیم نشده است.");
    return createAttachmentDownloadGrant({ expenseId: id, attachmentId: expense.attachment.id, businessId, branchId, userId: user.id }, secret);
  }

  async downloadAttachment(user: AuthenticatedUser, id: string, token?: string) {
    const { businessId, branchId } = this.scope(user);
    this.assertExpenseId(id);
    const expense = await this.prisma.expense.findFirst({ where: { id, businessId, branchId }, select: { attachment: { select: { id: true, storageKey: true, fileName: true, mimeType: true, bytes: true, checksum: true } } } });
    if (!expense?.attachment) throw new NotFoundException("پیوستی برای این هزینه ثبت نشده است.");
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) throw new ServiceUnavailableException("امضای امن دریافت فایل تنظیم نشده است.");
    if (!verifyAttachmentDownloadGrant(token, secret, { expenseId: id, attachmentId: expense.attachment.id, businessId, branchId, userId: user.id })) throw new UnauthorizedException("مجوز دریافت این فایل پایان یافته یا معتبر نیست؛ دوباره درخواست دریافت کنید.");
    const bytes = await this.attachmentStorage.read(expense.attachment.storageKey);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (BigInt(bytes.byteLength) !== expense.attachment.bytes || checksum !== expense.attachment.checksum) throw new ConflictException("محتوای ذخیره‌شدهٔ پیوست با اطلاعات ثبت‌شده هم‌خوانی ندارد.");
    return { bytes, fileName: expense.attachment.fileName, mimeType: expense.attachment.mimeType };
  }

  async removeAttachment(user: AuthenticatedUser, id: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.assertExpenseId(id);
    if (!this.canManageExpense(user)) throw new ForbiddenException("حذف پیوست برای نقش شما مجاز نیست.");
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockAttachmentMutationDuringBackup(tx);
      const expense = await tx.expense.findFirst({ where: { id, businessId, branchId }, select: { id: true, status: true, attachmentId: true } });
      if (!expense) throw new NotFoundException("هزینه پیدا نشد.");
      if (expense.status !== "DRAFT") throw new ConflictException("پس از ثبت نهایی هزینه نمی‌توان پیوست آن را تغییر داد.");
      if (!expense.attachmentId) throw new NotFoundException("پیوستی برای این هزینه ثبت نشده است.");
      const attachment = await tx.attachment.findFirst({ where: { id: expense.attachmentId, businessId }, select: { id: true, storageKey: true } });
      if (!attachment) throw new ConflictException("اطلاعات پیوست هزینه کامل نیست.");
      await tx.expense.update({ where: { id }, data: { attachmentId: null } });
      const remainingReferences = await tx.expense.count({ where: { businessId, attachmentId: attachment.id } });
      if (remainingReferences === 0) await tx.attachment.delete({ where: { id: attachment.id } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.attachment.removed", entityType: "expense", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { attachmentId: attachment.id } } });
      return { attachmentId: attachment.id, storageKey: remainingReferences === 0 ? attachment.storageKey : null };
    }, { isolationLevel: "Serializable" });
    if (removed.storageKey) await this.removeStoredAttachment(removed.storageKey, removed.attachmentId, request.requestId);
    return { id, removed: true };
  }

  async categories(user: AuthenticatedUser, includeArchived = false) {
    const { businessId } = this.scope(user);
    if (includeArchived && !this.canManageExpense(user)) throw new ForbiddenException();
    const rows = await this.prisma.expenseCategory.findMany({
      where: { businessId, ...(includeArchived ? {} : { isActive: true }) },
      select: { id: true, name: true, isActive: true, _count: { select: { expenses: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return rows.map(({ _count, ...category }) => ({ ...category, expenseCount: _count.expenses }));
  }

  async createCategory(user: AuthenticatedUser, dto: CreateExpenseCategoryDto, request: AppRequest) {
    const { businessId } = this.scope(user);
    if (!this.canManageExpense(user)) throw new ForbiddenException();
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException("نام دسته‌بندی حداقل باید دو نویسه باشد.");
    const duplicate = await this.prisma.expenseCategory.findFirst({ where: { businessId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (duplicate) throw new BadRequestException("دسته‌ای با این نام از قبل وجود دارد.");
    const ledger = await this.prisma.ledgerAccount.findFirst({ where: { businessId, systemKey: "general_expense", isActive: true }, select: { id: true } });
    if (!ledger) throw new BadRequestException("حساب دفتر هزینه‌های عمومی برای این کسب‌وکار پیدا نشد.");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.expenseCategory.create({ data: { businessId, name, expenseLedgerAccountId: ledger.id } });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense_category.created", entityType: "expense_category", entityId: category.id, requestId: request.requestId ?? "unknown", afterJson: { name } } });
        return { id: category.id, name: category.name };
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) throw new BadRequestException("دسته‌ای با این نام از قبل وجود دارد.");
      throw error;
    }
  }

  async updateCategory(user: AuthenticatedUser, id: string, dto: UpdateExpenseCategoryDto, request: AppRequest) {
    const { businessId } = this.scope(user);
    if (!this.canManageExpense(user)) throw new ForbiddenException();
    if (dto.name === undefined && dto.isActive === undefined) throw new BadRequestException("تغییری برای ذخیره انتخاب نشده است.");
    const before = await this.prisma.expenseCategory.findFirst({ where: { id, businessId } });
    if (!before) throw new NotFoundException("دسته‌بندی هزینه پیدا نشد.");
    const name = dto.name === undefined ? before.name : dto.name.trim();
    if (name.length < 2) throw new BadRequestException("نام دسته‌بندی حداقل باید دو نویسه باشد.");
    const isActive = dto.isActive ?? before.isActive;
    if (name !== before.name || isActive && !before.isActive) {
      const duplicate = await this.prisma.expenseCategory.findFirst({ where: { businessId, id: { not: id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (duplicate) throw new BadRequestException("دسته‌ای با این نام از قبل وجود دارد.");
    }
    const action = !isActive ? "expense_category.archived" : !before.isActive ? "expense_category.restored" : "expense_category.updated";
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.expenseCategory.update({ where: { id }, data: { name, isActive } });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action, entityType: "expense_category", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.name, isActive: before.isActive }, afterJson: { name: category.name, isActive: category.isActive } } });
        const expenseCount = await tx.expense.count({ where: { categoryId: id, businessId } });
        return { id: category.id, name: category.name, isActive: category.isActive, expenseCount };
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) throw new BadRequestException("دسته‌ای با این نام از قبل وجود دارد.");
      throw error;
    }
  }

  async create(user: AuthenticatedUser, dto: CreateExpenseDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const amount = money(dto.amountRial);
    const date = this.date(dto.txnDate);
    const category = await this.prisma.expenseCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true } });
    if (!category) throw new BadRequestException("دستهٔ هزینه متعلق به این کسب‌وکار نیست.");
    const payee = dto.payeeId ? await this.prisma.supplier.findFirst({ where: { id: dto.payeeId, businessId, party: { is: { archivedAt: null } } } }) : null;
    if (dto.payeeId && !payee) throw new BadRequestException("تأمین‌کننده انتخاب‌شده معتبر نیست.");
    const taxRate = dto.taxRateBasisPoints ?? 0;
    const tax = (amount * BigInt(taxRate) + 5000n) / 10000n;
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({ data: { businessId, branchId, categoryId: category.id, payeeId: payee?.id, txnDate: date, amountRial: amount, taxRateBasisPoints: taxRate, taxRial: tax, note: dto.note?.trim() || null, createdBy: user.id } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.draft.created", entityType: "expense", entityId: expense.id, requestId: request.requestId ?? "unknown", afterJson: { amountRial: amount.toString(), categoryId: category.id, txnDate: date.toISOString().slice(0, 10) } } });
      return { id: expense.id, amountRial: amount.toString(), taxRial: tax.toString(), status: expense.status };
    });
  }

  async updateDraft(user: AuthenticatedUser, id: string, dto: CreateExpenseDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const before = await this.prisma.expense.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, select: { id: true, amountRial: true, categoryId: true, payeeId: true, txnDate: true } });
    if (!before) throw new NotFoundException("پیش‌نویس هزینه پیدا نشد.");
    const amount = money(dto.amountRial);
    const date = this.date(dto.txnDate);
    const category = await this.prisma.expenseCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true } });
    if (!category) throw new BadRequestException("دستهٔ هزینه متعلق به این کسب‌وکار نیست.");
    const payee = dto.payeeId ? await this.prisma.supplier.findFirst({ where: { id: dto.payeeId, businessId, party: { is: { archivedAt: null } } } }) : null;
    if (dto.payeeId && !payee) throw new BadRequestException("پرداخت‌کنندهٔ انتخاب‌شده معتبر نیست.");
    const taxRate = dto.taxRateBasisPoints ?? 0;
    const tax = (amount * BigInt(taxRate) + 5000n) / 10000n;
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.expense.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, select: { id: true } });
      if (!current) throw new ConflictException("وضعیت هزینه تغییر کرده است؛ فهرست را تازه کنید.");
      const row = await tx.expense.update({ where: { id }, data: { amountRial: amount, categoryId: category.id, payeeId: payee?.id ?? null, txnDate: date, taxRateBasisPoints: taxRate, taxRial: tax, note: dto.note?.trim() || null } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.draft.updated", entityType: "expense", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { amountRial: before.amountRial.toString(), categoryId: before.categoryId, payeeId: before.payeeId }, afterJson: { amountRial: amount.toString(), categoryId: category.id, payeeId: payee?.id ?? null, txnDate: date.toISOString().slice(0, 10) } } });
      return row;
    });
    return { id: updated.id, status: updated.status, amountRial: updated.amountRial.toString(), taxRial: updated.taxRial.toString() };
  }

  async deleteDraft(user: AuthenticatedUser, id: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const deleted = await this.prisma.$transaction(async (tx) => {
      await lockAttachmentMutationDuringBackup(tx);
      const expense = await tx.expense.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, select: { id: true, expenseNo: true, amountRial: true, taxRial: true, attachmentId: true } });
      if (!expense) throw new ConflictException("فقط پیش‌نویس هزینه را می‌توان حذف کرد؛ سند نهایی باید با ابطال اصلاح شود.");
      let cleanup: { attachmentId: string; storageKey: string } | null = null;
      if (expense.attachmentId) {
        const attachment = await tx.attachment.findFirst({ where: { id: expense.attachmentId, businessId }, select: { id: true, storageKey: true } });
        if (!attachment) throw new ConflictException("اطلاعات پیوست هزینه کامل نیست.");
        await tx.expense.update({ where: { id }, data: { attachmentId: null } });
        const remainingReferences = await tx.expense.count({ where: { businessId, attachmentId: attachment.id } });
        if (remainingReferences === 0) {
          await tx.attachment.delete({ where: { id: attachment.id } });
          cleanup = { attachmentId: attachment.id, storageKey: attachment.storageKey };
        }
      }
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.draft.deleted", entityType: "expense", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { amountRial: expense.amountRial.toString(), expenseNo: expense.expenseNo } } });
      await tx.expense.delete({ where: { id } });
      return { id, status: "DELETED", cleanup };
    }, { isolationLevel: "Serializable" });
    if (deleted.cleanup) await this.removeStoredAttachment(deleted.cleanup.storageKey, deleted.cleanup.attachmentId, request.requestId);
    return { id: deleted.id, status: deleted.status };
  }

  async post(user: AuthenticatedUser, id: string, dto: PostExpenseDto, key?: string, request?: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ثبت هزینه الزامی است.");
    const bodyHash = this.accounting.idempotencyHash({ id, financeAccountId: dto.financeAccountId ?? null });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, bodyHash);
    if (previous) return previous;
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, businessId, branchId }, include: { category: true, payee: true } });
      if (!expense) throw new NotFoundException("هزینه پیدا نشد.");
      if (expense.status !== "DRAFT") throw new ConflictException("این هزینه قبلاً ثبت نهایی شده است.");
      await this.accounting.assertOpen(tx, businessId, expense.txnDate);
      const expenseNo = expense.expenseNo ?? await this.accounting.nextDocumentNumber(tx, { businessId, type: "EXPENSE", prefix: "E" });
      const cash = dto.financeAccountId ? await tx.financeAccount.findFirst({ where: { id: dto.financeAccountId, businessId, branchId, isActive: true } }) : null;
      if (dto.financeAccountId && !cash) throw new BadRequestException("حساب پرداخت معتبر نیست.");
      const payable = await this.accounting.account(tx, businessId, "accounts_payable");
      const inputTax = await this.accounting.account(tx, businessId, "input_tax");
      const journalSourceId = expense.id;
      const lines = [
        { ledgerAccountId: expense.category.expenseLedgerAccountId, debitRial: expense.amountRial, description: expense.category.name },
        ...(expense.taxRial > 0n ? [{ ledgerAccountId: inputTax, debitRial: expense.taxRial, description: "مالیات خرید" }] : []),
        { ledgerAccountId: cash?.ledgerAccountId ?? payable, creditRial: expense.amountRial + expense.taxRial, partyId: cash ? null : expense.payeeId, description: cash ? `پرداخت از ${cash.name}` : "بدهی هزینه" },
      ];
      const journal = await this.accounting.createJournal(tx, { businessId, branchId, date: expense.txnDate, sourceType: "EXPENSE", sourceId: journalSourceId, memo: expense.note ?? "ثبت هزینه", actorId: user.id, lines });
      if (cash) {
        const cashTxn = await tx.cashTransaction.create({ data: { businessId, branchId, kind: "PAYMENT", txnDate: expense.txnDate, amountRial: expense.amountRial + expense.taxRial, fromAccountId: cash.id, partyId: expense.payeeId, method: cash.kind === "CASH" ? "CASH" : cash.kind === "POS" ? "POS" : "BANK", reference: expenseNo, idempotencyKey: `expense:${expense.id}`, createdBy: user.id, journalEntryId: journal.id } });
        void cashTxn;
      }
      const posted = await tx.expense.update({ where: { id }, data: { expenseNo, status: "POSTED", postedAt: new Date() } });
      const result = { id: posted.id, status: posted.status, journalEntryId: journal.id, amountRial: (posted.amountRial + posted.taxRial).toString() };
      await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash: bodyHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.posted", entityType: "expense", entityId: posted.id, requestId: request?.requestId ?? "unknown", afterJson: result } });
      return result;
    }, { isolationLevel: "Serializable" });
  }

  async void(user: AuthenticatedUser, id: string, dto: VoidExpenseDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("ابطال هزینه برای نقش شما مجاز نیست.");
    if (!key || key.length > 128) throw new BadRequestException("کلید تکرارناپذیری برای ابطال هزینه لازم است.");
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException("دلیل ابطال را وارد کنید.");
    const requestHash = this.accounting.idempotencyHash({ id, reason, action: "void-expense" });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (previous) return previous;
    try {
      return await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, businessId, branchId }, select: { id: true, expenseNo: true, txnDate: true, status: true, amountRial: true, taxRial: true, payeeId: true } });
      if (!expense) throw new NotFoundException("هزینه پیدا نشد.");
      if (expense.status !== "POSTED") throw new ConflictException("فقط هزینهٔ ثبت‌شده قابل ابطال است.");
      await this.accounting.assertOpen(tx, businessId, expense.txnDate);
      const original = await tx.journalEntry.findFirst({ where: { businessId, branchId, sourceType: "EXPENSE", sourceId: id, status: "POSTED" }, include: { lines: true } });
      if (!original || !original.lines.length) throw new ConflictException("سند حسابداری هزینه برای ابطال پیدا نشد.");
      const reversal = await this.accounting.createJournal(tx, { businessId, branchId, date: expense.txnDate, sourceType: "EXPENSE_VOID", sourceId: id, reversalOfId: original.id, memo: `ابطال هزینه ${expense.expenseNo ?? ""}: ${reason}`, actorId: user.id, lines: original.lines.map((line) => ({ ledgerAccountId: line.ledgerAccountId, debitRial: line.creditRial, creditRial: line.debitRial, partyId: line.partyId, description: `برگشت ابطال: ${line.description ?? ""}` })) });
      const cashRows = await tx.cashTransaction.findMany({ where: { businessId, branchId, journalEntryId: original.id, kind: "PAYMENT", status: "POSTED" } });
      for (const cash of cashRows) {
        if (!cash.fromAccountId) throw new ConflictException("حساب پرداخت هزینه برای ابطال پیدا نشد.");
        await tx.cashTransaction.create({ data: { businessId, branchId, kind: "RECEIPT", txnDate: expense.txnDate, amountRial: cash.amountRial, toAccountId: cash.fromAccountId, partyId: cash.partyId, method: cash.method, reference: `VOID-${expense.expenseNo ?? id}`, status: "POSTED", journalEntryId: reversal.id, idempotencyKey: `expense-void:${id}:${cash.id}`, createdBy: user.id } });
      }
      await tx.journalEntry.update({ where: { id: original.id }, data: { status: "REVERSED" } });
      const updated = await tx.expense.update({ where: { id }, data: { status: "VOIDED" } });
      const result = { id, expenseNo: updated.expenseNo, status: updated.status, reason, reversalJournalId: reversal.id };
      await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.voided", entityType: "expense", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { status: expense.status }, afterJson: { ...result, amountRial: expense.amountRial.toString(), taxRial: expense.taxRial.toString(), payeeId: expense.payeeId } } });
      return result;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (this.isTransactionConflict(error)) {
        const saved = await this.accounting.existingIdempotentAfterConflict(user.id, businessId, key, requestHash);
        if (saved) return saved;
        throw new ConflictException("درخواست ابطال هم‌زمان پردازش شد؛ وضعیت هزینه را تازه‌سازی کنید.");
      }
      throw error;
    }
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private canManageExpense(user: AuthenticatedUser) { return ["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? ""); }
  private assertExpenseId(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException("شناسهٔ هزینه معتبر نیست."); }
  private async removeStoredAttachment(storageKey: string, attachmentId: string, requestId?: string) { try { await this.attachmentStorage.remove(storageKey); } catch { process.stderr.write(JSON.stringify({ level: "warn", event: "attachment.orphan_cleanup_failed", attachmentId, requestId: requestId ?? "unknown" }) + "\n"); } }
  private date(value?: string) { const dateText = value ?? new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new BadRequestException("تاریخ سند معتبر نیست."); const date = new Date(`${dateText}T00:00:00.000Z`); if (date.toISOString().slice(0, 10) !== dateText) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
  private isTransactionConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error.code === "P2002" || error.code === "P2034"); }
  private isUniqueConstraint(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
}
