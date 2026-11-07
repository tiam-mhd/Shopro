import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProductsService } from "./products.service.js";
import { ServicesService } from "./services.service.js";
import type { CreateProductDto, UpdateProductDto } from "./products.dto.js";
import type { CreateServiceDto, UpdateServiceDto } from "./services.dto.js";

export type CatalogSpreadsheetKind = "products" | "services";
export const MAX_CATALOG_SPREADSHEET_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 500;

type ColumnKey = "id" | "name" | "sku" | "barcode" | "unit" | "categoryId" | "category" | "price" | "cost" | "tax" | "quantity" | "reorder" | "trackInventory" | "active" | "description";
type PlanRow = {
  rowNumber: number;
  action: "create" | "update";
  id?: string;
  name: string;
  unitId: string;
  categoryId: string | null;
  categoryName: string | null;
  salePriceRial: string;
  defaultCostRial?: string | null;
  sku?: string | null;
  barcode?: string | null;
  taxRateBasisPoints: number;
  quantity?: string | null;
  reorderPoint?: string | null;
  trackInventory?: boolean;
  isActive?: boolean;
  description?: string | null;
  errors: string[];
};
type ImportPlan = { currency: "IRR" | "IRT"; rows: PlanRow[] };

const PERSIAN_HEADERS: Record<ColumnKey, string> = {
  id: "شناسه",
  name: "نام کالا یا خدمت *",
  sku: "کد کالا",
  barcode: "بارکد",
  unit: "واحد (شناسه، کد یا نام) *",
  categoryId: "شناسه دسته‌بندی",
  category: "دسته‌بندی",
  price: "قیمت فروش (واحد پول کسب‌وکار) *",
  cost: "بهای خرید پیش‌فرض (واحد پول کسب‌وکار)",
  tax: "نرخ مالیات (درصد)",
  quantity: "موجودی فعلی",
  reorder: "حد هشدار موجودی",
  trackInventory: "مدیریت موجودی",
  active: "فعال",
  description: "شرح خدمت",
};

const PRODUCT_COLUMNS: ColumnKey[] = ["id", "name", "sku", "barcode", "unit", "categoryId", "category", "price", "cost", "tax", "quantity", "reorder", "trackInventory", "active"];
const SERVICE_COLUMNS: ColumnKey[] = ["id", "name", "unit", "categoryId", "category", "price", "tax", "description", "active"];

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  id: ["شناسه", "شناسه کالا", "شناسه خدمت", "id", "item id", "product id", "service id"],
  name: ["نام کالا یا خدمت *", "نام کالا", "نام خدمت", "نام *", "name", "item name", "product name", "service name"],
  sku: ["کد کالا", "کد", "sku", "کد محصول"],
  barcode: ["بارکد", "barcode"],
  unit: ["واحد (شناسه، کد یا نام) *", "واحد", "واحد ارائه", "unit", "unit code", "unit name"],
  categoryId: ["شناسه دسته‌بندی", "شناسه دسته بندی", "category id"],
  category: ["دسته‌بندی", "دسته بندی", "category"],
  price: ["قیمت فروش (واحد پول کسب‌وکار) *", "قیمت فروش", "قیمت", "sale price", "price"],
  cost: ["بهای خرید پیش‌فرض (واحد پول کسب‌وکار)", "بهای خرید پیش‌فرض", "بهای خرید", "default cost", "cost"],
  tax: ["نرخ مالیات (درصد)", "نرخ مالیات", "مالیات", "tax rate", "tax"],
  quantity: ["موجودی فعلی", "موجودی", "quantity", "stock"],
  reorder: ["حد هشدار موجودی", "حد هشدار", "reorder point"],
  trackInventory: ["مدیریت موجودی", "پیگیری موجودی", "track inventory"],
  active: ["فعال", "وضعیت فعال", "is active", "active"],
  description: ["شرح خدمت", "شرح", "توضیحات", "description"],
};

const normal = (value: string) => normalizePersianSearch(value).replace(/[()_*]/g, " ").replace(/\s+/g, " ").trim();
const cleanCellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object" && value && "result" in value) return cleanCellText((value as { result?: unknown }).result);
  throw new Error("فقط مقدار سادهٔ متن یا عدد قابل ورود است؛ فرمول و پیوند را به مقدار ثابت تبدیل کنید.");
};

function parseNumberText(raw: string, label: string, maxDecimals: number, allowEmpty = false): string | null {
  let value = toAsciiDigits(raw).replace(/[٬,\s]/g, "").replace(/٫/g, ".").trim();
  if (!value && allowEmpty) return null;
  if (!value) throw new Error(`${label} را وارد کنید.`);
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(value)) throw new Error(`${label} باید یک عدد نامنفی باشد.`);
  const decimals = value.split(".")[1]?.length ?? 0;
  if (decimals > maxDecimals) throw new Error(`${label} حداکثر ${maxDecimals} رقم اعشار می‌پذیرد.`);
  if (value.includes(".")) value = value.replace(/0+$/, "").replace(/\.$/, "");
  return value;
}

function parseMoneyRial(raw: string, currency: "IRR" | "IRT", label: string, optional = false): string | null {
  const normalized = toAsciiDigits(raw).replace(/[٬,\s]/g, "").replace(/٫/g, ".").trim();
  if (!normalized && optional) return null;
  if (!normalized) throw new Error(`${label} را وارد کنید.`);
  const validAmount = currency === "IRT" ? /^\d{1,19}(?:\.\d{1,1})?$/ : /^\d{1,20}$/;
  if (!validAmount.test(normalized)) {
    throw new Error(`${label} باید مبلغ نامنفی و به ${currency === "IRT" ? "تومان" : "ریال"} باشد.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  return (BigInt(whole) * (currency === "IRT" ? 10n : 1n) + BigInt((fraction || "0").padEnd(1, "0"))).toString();
}

function parseTax(raw: string): number {
  const value = toAsciiDigits(raw).replace(/[٬,\s]/g, "").replace(/٫/g, ".").trim();
  if (!value) return 0;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value) || Number(value) > 100) throw new Error("نرخ مالیات باید بین صفر تا ۱۰۰ درصد و حداکثر با دو رقم اعشار باشد.");
  return Math.round(Number(value) * 100);
}

function parseBoolean(raw: string, label: string, defaultValue: boolean): boolean {
  const value = normal(raw);
  if (!value) return defaultValue;
  if (["true", "1", "yes", "بله", "فعال", "روشن"].includes(value)) return true;
  if (["false", "0", "no", "خیر", "غیرفعال", "خاموش"].includes(value)) return false;
  throw new Error(`${label} را با بله/خیر یا ۱/۰ وارد کنید.`);
}

function buildWorkbook(kind: CatalogSpreadsheetKind, currency: "IRR" | "IRT", branchName: string, rows: Array<Record<string, string | null>>, units: Array<{ id: string; code: string; labelFa: string; precision: number }>, categories: Array<{ id: string; name: string; parentName: string | null; isActive: boolean }>) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Shopro";
  workbook.subject = `${kind === "products" ? "ورود و خروجی کالاهای" : "ورود و خروجی خدمات"} شعبهٔ ${branchName}`;
  workbook.created = new Date();
  const columns = kind === "products" ? PRODUCT_COLUMNS : SERVICE_COLUMNS;
  const worksheet = workbook.addWorksheet("ورود اطلاعات", { views: [{ state: "frozen", ySplit: 1, rightToLeft: true }] });
  worksheet.columns = columns.map((key) => ({ header: key === "price" ? `قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"}) *` : key === "cost" ? `بهای خرید پیش‌فرض (${currency === "IRT" ? "تومان" : "ریال"})` : PERSIAN_HEADERS[key], key, width: key === "name" ? 30 : key === "description" ? 42 : key === "unit" ? 27 : key === "price" || key === "cost" ? 25 : 20, style: ["id", "sku", "barcode", "price", "cost", "quantity", "reorder"].includes(key) ? { numFmt: "@" } : undefined }));
  for (const row of rows) worksheet.addRow(Object.fromEntries(columns.map((key) => [key, row[key] ?? ""])));
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = worksheet.getRow(1);
  header.height = 32;
  header.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF147D61" } };
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.height = 24;
    row.alignment = { vertical: "middle", wrapText: true };
    if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F7F4" } };
  });
  const guide = workbook.addWorksheet("راهنما", { views: [{ rightToLeft: true }] });
  guide.columns = [{ width: 34 }, { width: 100 }];
  guide.addRow(["راهنمای فایل اکسل", ""]);
  guide.mergeCells("A1:B1");
  guide.getCell("A1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  guide.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF147D61" } };
  guide.getCell("A1").alignment = { vertical: "middle", horizontal: "right" };
  const guideRows = [
    ["شعبه و نوع فایل", `این فایل برای ${kind === "products" ? "کالاهای" : "خدمات"} شعبهٔ «${branchName}» ساخته شده است. فایل را در همان کسب‌وکار و شعبه وارد کنید.`],
    ["ستون‌های لازم", "نام، واحد و قیمت فروش باید تکمیل شوند. ستون‌های دیگر را می‌توانید متناسب با نوع کالا یا خدمت خالی بگذارید."],
    ["به‌روزرسانی", "اگر شناسه پر باشد، همان رکورد در همین شعبه ویرایش می‌شود. برای کالا، در نبود شناسه کد کالا یا بارکد نیز برای یافتن رکورد به کار می‌رود. شناسهٔ ناشناخته ردیف جدید نمی‌سازد."],
    ["ثبت مورد تازه", "شناسه را خالی بگذارید. کد و بارکد کالا باید در این شعبه تکراری نباشند. دسته‌بندی تازه با نام واردشده در همین شعبه ساخته می‌شود؛ دسته‌بندی موجود را با شناسه یا نام آن انتخاب کنید."],
    ["واحد", "واحد را با شناسه، کد یا نام واحد وارد کنید. واحد باید در فهرست واحدهای فعال کسب‌وکار قابل استفاده باشد."],
    ["مبلغ‌ها", `قیمت و بهای خرید را به ${currency === "IRT" ? "تومان" : "ریال"} وارد کنید. مبلغ‌ها در فایل به‌صورت متن نگهداری می‌شوند تا دقت اعداد بزرگ حفظ شود. در ریال عدد صحیح و در تومان حداکثر یک رقم اعشار پذیرفته می‌شود.`],
    ["مالیات", "نرخ مالیات به درصد است؛ برای نمونه ۹ یعنی ۹ درصد. حداکثر دو رقم اعشار پذیرفته می‌شود."],
    ["موجودی کالا", "موجودی فعلی به‌عنوان اصلاح شمارش ثبت می‌شود و گردش موجودی و حسابداری شعبه را ایجاد می‌کند. اگر خانه خالی باشد موجودی تغییر نمی‌کند؛ در کالای تازه، موجودی خالی برابر صفر است."],
    ["مدیریت موجودی و فعال", "برای مقدارهای بله/خیر از بله، خیر، ۱ یا ۰ استفاده کنید. ردیف‌های غیرفعال در سامانه بایگانی می‌شوند."],
    ["خدمات", "خدمت موجودی انبار، بارکد یا بهای خرید ندارد. شرح خدمت از ستون شرح خدمت دریافت می‌شود."],
    ["تصاویر", "تصاویر کالا و خدمت از گالری مدیریت می‌شوند و در فایل اکسل بارگذاری یا حذف نمی‌شوند."],
    ["تکمیل فایل", `فقط شیت «ورود اطلاعات» را ویرایش کنید. حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بار پردازش می‌شود. فرمول‌ها را پیش از بارگذاری به مقدار ثابت تبدیل کنید.`],
  ];
  for (const row of guideRows) guide.addRow(row);
  guide.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 34 : 42;
    row.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    if (rowNumber > 1) {
      row.getCell(1).font = { name: "Arial", bold: true, color: { argb: "FF176A55" } };
      row.getCell(2).font = { name: "Arial", color: { argb: "FF26342E" } };
      if (rowNumber % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F7F4" } };
    }
  });
  const unitSheet = workbook.addWorksheet("واحدها");
  unitSheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  unitSheet.columns = [{ header: "شناسه واحد", key: "id", width: 38 }, { header: "کد واحد", key: "code", width: 22 }, { header: "نام واحد", key: "labelFa", width: 24 }, { header: "دقت اعشار", key: "precision", width: 16 }];
  for (const unit of units) unitSheet.addRow(unit);
  const categorySheet = workbook.addWorksheet("دسته‌بندی‌ها");
  categorySheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  categorySheet.columns = [{ header: "شناسه دسته‌بندی", key: "id", width: 38 }, { header: "نام دسته‌بندی", key: "name", width: 30 }, { header: "دسته والد", key: "parentName", width: 30 }, { header: "وضعیت", key: "isActive", width: 16 }];
  for (const category of categories) categorySheet.addRow({ ...category, isActive: category.isActive ? "فعال" : "بایگانی‌شده" });
  for (const sheet of [unitSheet, categorySheet]) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    const row = sheet.getRow(1);
    row.height = 30;
    row.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    row.alignment = { horizontal: "center", vertical: "middle" };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF147D61" } };
  }
  return workbook;
}

@Injectable()
export class CatalogSpreadsheetService {
  constructor(private readonly prisma: PrismaService, private readonly products: ProductsService, private readonly services: ServicesService) {}

  async template(user: AuthenticatedUser, kind: CatalogSpreadsheetKind) {
    const { businessId, branchId, currency, branchName } = await this.context(user);
    const references = await this.references(businessId, branchId, kind);
    return buildWorkbook(kind, currency, branchName, [], references.units, references.categories).xlsx.writeBuffer();
  }

  async export(user: AuthenticatedUser, kind: CatalogSpreadsheetKind) {
    const { businessId, branchId, currency, branchName } = await this.context(user);
    const references = await this.references(businessId, branchId, kind);
    if (kind === "products") {
      const products = await this.prisma.product.findMany({ where: { businessId, branchId }, include: { catalogItem: { include: { unit: true } }, category: true, balances: { where: { branchId }, select: { quantityOnHand: true } } }, orderBy: [{ catalogItem: { normalizedName: "asc" } }, { id: "asc" }] });
      const rows = products.map((item) => ({ id: item.id, name: item.catalogItem.name, sku: item.sku, barcode: item.barcode, unit: item.catalogItem.unit.code, categoryId: item.categoryId, category: item.category?.name ?? null, price: this.moneyForCurrency(item.catalogItem.salePriceRial, currency), cost: item.defaultCostRial === null ? null : this.moneyForCurrency(item.defaultCostRial, currency), tax: String(item.catalogItem.taxRateBasisPoints / 100), quantity: item.balances[0]?.quantityOnHand.toString() ?? "0", reorder: item.reorderPoint?.toString() ?? null, trackInventory: item.trackInventory ? "بله" : "خیر", active: item.catalogItem.isActive ? "بله" : "خیر" }));
      return buildWorkbook(kind, currency, branchName, rows, references.units, references.categories).xlsx.writeBuffer();
    }
    const services = await this.prisma.service.findMany({ where: { businessId, branchId }, include: { catalogItem: { include: { unit: true } }, category: true }, orderBy: [{ catalogItem: { normalizedName: "asc" } }, { id: "asc" }] });
    const rows = services.map((item) => ({ id: item.id, name: item.catalogItem.name, unit: item.catalogItem.unit.code, categoryId: item.categoryId, category: item.category?.name ?? null, price: this.moneyForCurrency(item.catalogItem.salePriceRial, currency), tax: String(item.catalogItem.taxRateBasisPoints / 100), description: item.description, active: item.catalogItem.isActive ? "بله" : "خیر" }));
    return buildWorkbook(kind, currency, branchName, rows, references.units, references.categories).xlsx.writeBuffer();
  }

  async preview(user: AuthenticatedUser, kind: CatalogSpreadsheetKind, file: { originalname?: string; buffer?: Buffer; size?: number } | undefined) {
    this.requireEditor(user);
    const plan = await this.makePlan(user, kind, file);
    return this.summarize(plan);
  }

  async import(user: AuthenticatedUser, kind: CatalogSpreadsheetKind, file: { originalname?: string; buffer?: Buffer; size?: number } | undefined, request: AppRequest) {
    this.requireEditor(user);
    const plan = await this.makePlan(user, kind, file);
    const categoryCache = new Map<string, string>();
    const results: Array<{ rowNumber: number; name: string; action: "create" | "update"; success: boolean; message: string }> = [];
    for (const row of plan.rows) {
      if (row.errors.length) {
        results.push({ rowNumber: row.rowNumber, name: row.name, action: row.action, success: false, message: row.errors.join(" ") });
        continue;
      }
      try {
        let categoryId = row.categoryId;
        if (!categoryId && row.categoryName) categoryId = await this.resolveOrCreateCategory(user, kind, row.categoryName, categoryCache, request);
        if (kind === "products") {
          const values: CreateProductDto | UpdateProductDto = {
            name: row.name,
            unitId: row.unitId,
            categoryId,
            salePriceRial: row.salePriceRial,
            sku: row.sku,
            barcode: row.barcode,
            defaultCostRial: row.defaultCostRial,
            reorderPoint: row.reorderPoint,
            taxRateBasisPoints: row.taxRateBasisPoints,
            trackInventory: row.trackInventory,
            isActive: row.isActive,
            ...(row.action === "create" ? { initialQuantity: row.quantity ?? "0" } : row.quantity && row.trackInventory !== false ? { currentQuantity: row.quantity } : {}),
          } as CreateProductDto | UpdateProductDto;
          if (row.action === "create") await this.products.create(user, values as CreateProductDto, request);
          else await this.products.update(user, row.id!, values as UpdateProductDto, request);
        } else {
          const values: CreateServiceDto | UpdateServiceDto = { name: row.name, unitId: row.unitId, categoryId, salePriceRial: row.salePriceRial, taxRateBasisPoints: row.taxRateBasisPoints, description: row.description, isActive: row.isActive };
          if (row.action === "create") await this.services.create(user, values as CreateServiceDto, request);
          else await this.services.update(user, row.id!, values as UpdateServiceDto, request);
        }
        results.push({ rowNumber: row.rowNumber, name: row.name, action: row.action, success: true, message: row.action === "create" ? "ثبت شد." : "به‌روزرسانی شد." });
      } catch (error) {
        results.push({ rowNumber: row.rowNumber, name: row.name, action: row.action, success: false, message: this.errorText(error) });
      }
    }
    return { total: plan.rows.length, imported: results.filter((result) => result.success).length, failed: results.filter((result) => !result.success).length, results };
  }

  private async makePlan(user: AuthenticatedUser, kind: CatalogSpreadsheetKind, file: { originalname?: string; buffer?: Buffer; size?: number } | undefined): Promise<ImportPlan> {
    const { businessId, branchId, currency, inventoryEnabled } = await this.context(user);
    if (!file?.buffer?.byteLength) throw new BadRequestException("فایل اکسل را انتخاب کنید.");
    if (file.buffer.byteLength > MAX_CATALOG_SPREADSHEET_BYTES) throw new BadRequestException("حجم فایل نباید از ۵ مگابایت بیشتر باشد.");
    if (!file.originalname?.toLocaleLowerCase("en-US").endsWith(".xlsx")) throw new BadRequestException("فقط فایل اکسل با پسوند xlsx پذیرفته می‌شود.");

    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
    catch { throw new BadRequestException("ساختار فایل اکسل قابل‌خواندن نیست. قالب xlsx را دوباره دریافت کنید."); }
    const worksheet = workbook.getWorksheet("ورود اطلاعات") ?? workbook.worksheets.find((sheet) => sheet.rowCount > 0);
    if (!worksheet || worksheet.columnCount > 30 || worksheet.rowCount > MAX_IMPORT_ROWS + 1) throw new BadRequestException(`فایل باید حداکثر ${MAX_IMPORT_ROWS} ردیف و ۳۰ ستون داشته باشد.`);

    const columns = kind === "products" ? PRODUCT_COLUMNS : SERVICE_COLUMNS;
    const headerMap = new Map<ColumnKey, number>();
    const headerRow = worksheet.getRow(1);
    for (let column = 1; column <= worksheet.columnCount; column++) {
      let raw = "";
      try { raw = cleanCellText(headerRow.getCell(column).value); } catch { continue; }
      if (!raw) continue;
      const normalized = normal(raw);
      for (const key of columns) {
      if (HEADER_ALIASES[key].some((alias) => normal(alias) === normalized) || ((key === "price" || key === "cost") && (normalized.startsWith(normal(key === "price" ? "قیمت فروش" : "بهای خرید پیش‌فرض")) || normalized.startsWith(key === "price" ? "sale price" : "default cost")))) {
          if (headerMap.has(key)) throw new BadRequestException(`ستون «${PERSIAN_HEADERS[key]}» بیش از یک بار آمده است.`);
          headerMap.set(key, column);
          break;
        }
      }
    }
    for (const key of ["name", "unit", "price"] as const) if (!headerMap.has(key)) throw new BadRequestException(`ستون «${PERSIAN_HEADERS[key]}» در فایل پیدا نشد.`);
    const currencyForColumn = (key: "price" | "cost") => {
      const column = headerMap.get(key);
      if (!column) return currency;
      const header = normal(cleanCellText(headerRow.getCell(column).value));
      if (header.includes(normal("تومان")) || header.includes("irt")) return "IRT" as const;
      if (header.includes(normal("ریال")) || header.includes("irr")) return "IRR" as const;
      return currency;
    };
    const saleCurrency = currencyForColumn("price");
    const costCurrency = currencyForColumn("cost");

    const units = await this.prisma.unit.findMany({ where: { businessId }, select: { id: true, code: true, labelFa: true, precision: true, isVisible: true } });
    const categoryRows = kind === "products"
      ? await this.prisma.productCategory.findMany({ where: { businessId, branchId }, select: { id: true, name: true, isActive: true } })
      : await this.prisma.serviceCategory.findMany({ where: { businessId, branchId }, select: { id: true, name: true, isActive: true } });
    const existing = kind === "products"
      ? await this.prisma.product.findMany({ where: { businessId, branchId }, include: { catalogItem: { include: { unit: true } }, category: true, balances: { where: { branchId }, select: { quantityOnHand: true } } } })
      : await this.prisma.service.findMany({ where: { businessId, branchId }, include: { catalogItem: { include: { unit: true } }, category: true } });

    const rows: PlanRow[] = [];
    const seenIds = new Set<string>();
    const seenSku = new Set<string>();
    const seenBarcode = new Set<string>();
    for (let index = 2; index <= worksheet.rowCount; index++) {
      const excelRow = worksheet.getRow(index);
      const rawValues = new Map<ColumnKey, string>();
      let hasContent = false;
      const cellErrors: string[] = [];
      for (const key of columns) {
        const column = headerMap.get(key);
        if (!column) continue;
        const cell = excelRow.getCell(column);
        if (cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) {
          cellErrors.push(`سلول «${PERSIAN_HEADERS[key]}» دارای فرمول است؛ مقدار ثابت وارد کنید.`);
          continue;
        }
        try {
          const value = cleanCellText(cell.value);
          rawValues.set(key, value);
          if (value) hasContent = true;
        } catch (error) { cellErrors.push(this.errorText(error)); }
      }
      if (!hasContent && cellErrors.length === 0) continue;
      const errors = [...cellErrors];
      const value = (key: ColumnKey) => rawValues.get(key) ?? "";
      const identifier = value("id");
      const name = value("name");
      const sku = value("sku").trim() || null;
      const barcode = value("barcode").trim() || null;
      let target: (typeof existing)[number] | undefined;
      let action: "create" | "update" = "create";

      if (!name) errors.push("نام را وارد کنید.");
      else if (name.length > 160) errors.push("نام حداکثر ۱۶۰ نویسه می‌تواند باشد.");
      if (kind === "products") {
        if (sku && sku.length > 48) errors.push("کد کالا حداکثر ۴۸ نویسه می‌تواند باشد.");
        if (barcode && (barcode.length < 4 || barcode.length > 64)) errors.push("بارکد باید بین ۴ تا ۶۴ نویسه باشد.");
        if (sku && seenSku.has(normal(sku))) errors.push("کد کالا در همین فایل تکرار شده است.");
        if (barcode && seenBarcode.has(normal(barcode))) errors.push("بارکد در همین فایل تکرار شده است.");
        if (sku) seenSku.add(normal(sku));
        if (barcode) seenBarcode.add(normal(barcode));
      }

      if (identifier) {
        target = existing.find((item) => item.id.toLowerCase() === identifier.toLowerCase());
        if (!target) errors.push("شناسه در همین شعبه پیدا نشد؛ برای ساخت مورد تازه شناسه را خالی بگذارید.");
      } else if (kind === "products") {
        const skuTarget = sku ? existing.find((item) => "sku" in item && item.sku && normal(item.sku) === normal(sku)) : undefined;
        const barcodeTarget = barcode ? existing.find((item) => "barcode" in item && item.barcode && normal(item.barcode) === normal(barcode)) : undefined;
        if (skuTarget && barcodeTarget && skuTarget.id !== barcodeTarget.id) errors.push("کد کالا و بارکد به دو کالای متفاوت اشاره می‌کنند.");
        target = skuTarget ?? barcodeTarget;
      }
      if (target) {
        action = "update";
        if (seenIds.has(target.id)) errors.push("یک کالا یا خدمت در همین فایل بیش از یک بار هدف قرار گرفته است.");
        seenIds.add(target.id);
        if (kind === "products") {
          const conflictingSku = sku ? existing.find((item) => "sku" in item && item.sku && normal(item.sku) === normal(sku) && item.id !== target!.id) : undefined;
          const conflictingBarcode = barcode ? existing.find((item) => "barcode" in item && item.barcode && normal(item.barcode) === normal(barcode) && item.id !== target!.id) : undefined;
          if (conflictingSku || conflictingBarcode) errors.push("کد کالا یا بارکد قبلاً برای کالای دیگری در این شعبه ثبت شده است.");
        }
      } else if (identifier) action = "update";

      let unitText = value("unit");
      if (!unitText && target) unitText = "";
      let unit = unitText ? units.find((item) => item.id === unitText) ?? units.find((item) => normal(item.code) === normal(unitText)) ?? units.find((item) => normal(item.labelFa) === normal(unitText)) : undefined;
      if (!unit && target && !unitText) unit = units.find((item) => item.id === target!.catalogItem.unitId);
      if (!unit) errors.push("واحد را با شناسه، کد یا نام معتبر وارد کنید.");
      else if (!unit.isVisible && (!target || unit.id !== target.catalogItem.unitId)) errors.push("واحد انتخاب‌شده در فهرست واحدهای قابل استفاده نیست.");

      const categoryIdValue = value("categoryId");
      const categoryName = value("category").trim();
      let categoryId: string | null = null;
      if (categoryIdValue) {
        const category = categoryRows.find((item) => item.id.toLowerCase() === categoryIdValue.toLowerCase());
        if (!category) errors.push("شناسهٔ دسته‌بندی در همین شعبه پیدا نشد.");
        else if (!category.isActive && (!target || target.categoryId !== category.id)) errors.push("دسته‌بندی انتخاب‌شده بایگانی شده است؛ ابتدا آن را فعال کنید.");
        else if (categoryName && normal(category.name) !== normal(categoryName)) errors.push("نام دسته‌بندی با شناسهٔ واردشده هم‌خوان نیست.");
        else categoryId = category.id;
      } else if (categoryName) {
        const matches = categoryRows.filter((item) => normal(item.name) === normal(categoryName));
        if (matches.length > 1) errors.push("نام دسته‌بندی تکراری است؛ شناسهٔ دسته‌بندی را وارد کنید.");
        else if (matches[0] && !matches[0].isActive && (!target || target.categoryId !== matches[0].id)) errors.push("دسته‌بندی انتخاب‌شده بایگانی شده است؛ ابتدا آن را فعال کنید.");
        else if (matches[0]) categoryId = matches[0].id;
        else if (categoryName.length < 2 || categoryName.length > 100) errors.push("نام دسته‌بندی تازه باید بین ۲ تا ۱۰۰ نویسه باشد.");
      }

      let salePriceRial = "0";
      try { salePriceRial = parseMoneyRial(value("price"), saleCurrency, "قیمت فروش") ?? "0"; } catch (error) { errors.push(this.errorText(error)); }
      let defaultCostRial: string | null = null;
      let taxRateBasisPoints = 0;
      let quantity: string | null = null;
      let reorderPoint: string | null = null;
      let trackInventory: boolean | undefined;
      let isActive: boolean | undefined;
      let description: string | null = null;
      if (kind === "products") {
        try { defaultCostRial = parseMoneyRial(value("cost"), costCurrency, "بهای خرید پیش‌فرض", true); } catch (error) { errors.push(this.errorText(error)); }
        try { taxRateBasisPoints = parseTax(value("tax")); } catch (error) { errors.push(this.errorText(error)); }
        const quantityText = value("quantity");
        if (quantityText) {
          try { quantity = parseNumberText(quantityText, "موجودی فعلی", unit?.precision ?? 3) ?? null; } catch (error) { errors.push(this.errorText(error)); }
        } else if (!target) quantity = "0";
        const reorderText = value("reorder");
        if (reorderText) {
          try { reorderPoint = parseNumberText(reorderText, "حد هشدار موجودی", unit?.precision ?? 3) ?? null; } catch (error) { errors.push(this.errorText(error)); }
        }
        try { trackInventory = parseBoolean(value("trackInventory"), "مدیریت موجودی", target && "trackInventory" in target ? target.trackInventory : true); } catch (error) { errors.push(this.errorText(error)); }
        if (!trackInventory && quantity !== null && quantity !== "0") errors.push("برای کالای بدون مدیریت موجودی، مقدار موجودی باید صفر یا خالی باشد.");
        if (!inventoryEnabled && quantity !== null && quantity !== "0") errors.push("مدیریت موجودی برای این کسب‌وکار فعال نیست؛ مقدار موجودی را صفر یا خالی کنید.");
      } else {
        try { taxRateBasisPoints = parseTax(value("tax")); } catch (error) { errors.push(this.errorText(error)); }
        description = value("description").trim() || null;
        if (description && description.length > 1000) errors.push("شرح خدمت حداکثر ۱۰۰۰ نویسه می‌تواند باشد.");
      }
      if (value("active")) {
        try { isActive = parseBoolean(value("active"), "وضعیت فعال", target ? target.catalogItem.isActive : true); } catch (error) { errors.push(this.errorText(error)); }
      } else if (target) isActive = target.catalogItem.isActive;
      else isActive = true;

      rows.push({ rowNumber: index, action, id: target?.id ?? (identifier || undefined), name, unitId: unit?.id ?? "", categoryId, categoryName: !categoryId && categoryName ? categoryName : null, salePriceRial, defaultCostRial, sku, barcode, taxRateBasisPoints, quantity, reorderPoint, trackInventory, isActive, description, errors: [...new Set(errors)] });
    }
    if (!rows.length) throw new BadRequestException("در شیت «ورود اطلاعات» ردیف داده‌ای پیدا نشد.");
    return { currency, rows };
  }

  private summarize(plan: ImportPlan) {
    return { total: plan.rows.length, ready: plan.rows.filter((row) => row.errors.length === 0).length, invalid: plan.rows.filter((row) => row.errors.length > 0).length, creates: plan.rows.filter((row) => row.action === "create" && row.errors.length === 0).length, updates: plan.rows.filter((row) => row.action === "update" && row.errors.length === 0).length, rows: plan.rows.map((row) => ({ rowNumber: row.rowNumber, name: row.name || "—", action: row.action, valid: row.errors.length === 0, errors: row.errors })) };
  }

  private async resolveOrCreateCategory(user: AuthenticatedUser, kind: CatalogSpreadsheetKind, name: string, cache: Map<string, string>, request: AppRequest) {
    const key = normal(name);
    const cached = cache.get(key);
    if (cached) return cached;
    const categories = kind === "products" ? await this.products.categories(user) : await this.services.categories(user);
    const existing = categories.find((category) => normal(category.name) === key);
    if (existing) { cache.set(key, existing.id); return existing.id; }
    const created = kind === "products" ? await this.products.createCategory(user, { name }, request) : await this.services.createCategory(user, { name }, request);
    cache.set(key, created.id);
    return created.id;
  }

  private async context(user: AuthenticatedUser) {
    if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار را انتخاب کنید.");
    if (!user.branchId) throw new BadRequestException("ابتدا یک شعبه را انتخاب کنید.");
    const [business, branch] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: user.businessId }, select: { displayCurrency: true, inventoryEnabled: true } }),
      this.prisma.branch.findFirst({ where: { id: user.branchId, businessId: user.businessId }, select: { name: true } }),
    ]);
    if (!business) throw new BadRequestException("کسب‌وکار انتخاب‌شده پیدا نشد.");
    if (!branch) throw new BadRequestException("شعبهٔ انتخاب‌شده در این کسب‌وکار در دسترس نیست.");
    return { businessId: user.businessId, branchId: user.branchId, branchName: branch.name, currency: business.displayCurrency as "IRR" | "IRT", inventoryEnabled: business.inventoryEnabled };
  }

  private async references(businessId: string, branchId: string, kind: CatalogSpreadsheetKind) {
    const units = await this.prisma.unit.findMany({ where: { businessId, isVisible: true }, select: { id: true, code: true, labelFa: true, precision: true }, orderBy: [{ groupKey: "asc" }, { labelFa: "asc" }] });
    const categories = kind === "products"
      ? await this.prisma.productCategory.findMany({ where: { businessId, branchId }, select: { id: true, name: true, isActive: true, parent: { select: { name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] })
      : await this.prisma.serviceCategory.findMany({ where: { businessId, branchId }, select: { id: true, name: true, isActive: true, parent: { select: { name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
    return { units, categories: categories.map(({ id, name, isActive, parent }) => ({ id, name, isActive, parentName: parent?.name ?? null })) };
  }

  private requireEditor(user: AuthenticatedUser) {
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("برای ورود گروهی کالا یا خدمت دسترسی ویرایش لازم است.");
  }

  private moneyForCurrency(rial: bigint, currency: "IRR" | "IRT") {
    if (currency === "IRR") return rial.toString();
    const whole = rial / 10n;
    const fraction = rial % 10n;
    return fraction === 0n ? whole.toString() : `${whole}.${fraction}`;
  }

  private errorText(error: unknown) {
    if (error instanceof Error) return error.message;
    return "ثبت ردیف انجام نشد.";
  }
}
