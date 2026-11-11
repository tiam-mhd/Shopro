import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export const KAASH_STATUSES = ["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "RELEASED", "ARCHIVED"] as const;
export const KAASH_MODULES = ["DASHBOARD", "ONBOARDING", "SUBSCRIPTIONS", "STOREFRONT", "SALES", "INVOICES", "CUSTOMERS", "SUPPLIERS", "PRODUCTS", "SERVICES", "INVENTORY", "PURCHASES", "EXPENSES", "FINANCE", "LEDGER", "REPORTS", "SETTINGS", "OTHER"] as const;
export const KAASH_SCREEN_KEYS = [
  "dashboard.home", "onboarding.workspace", "subscriptions.management", "storefront.management",
  "sales.register", "invoices.list", "invoices.detail", "customers.list", "customers.detail", "suppliers.list", "suppliers.detail", "parties.detail",
  "products.list", "products.detail", "products.categories", "services.list", "services.detail", "services.categories",
  "inventory.list", "inventory.count-detail", "purchases.list", "purchases.detail", "expenses.list", "expenses.detail",
  "expenses.categories", "finance.overview", "finance.detail", "ledger.entries", "reports.overview", "settings.workspace", "workspace.other",
] as const;

export class SubmitKaashDto {
  @IsUUID("4") clientSubmissionId!: string;
  @IsIn(KAASH_SCREEN_KEYS) screenKey!: (typeof KAASH_SCREEN_KEYS)[number];
  @IsString() @MaxLength(4000) content!: string;
}

export class AdminKaashListQueryDto {
  @IsOptional() @IsString() @MaxLength(160) q?: string;
  @IsOptional() @IsIn(KAASH_STATUSES) status?: (typeof KAASH_STATUSES)[number];
  @IsOptional() @IsIn(KAASH_MODULES) module?: (typeof KAASH_MODULES)[number];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class UpdateKaashDto {
  @IsOptional() @IsIn(KAASH_STATUSES) status?: (typeof KAASH_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(4000) internalNote?: string | null;
}
