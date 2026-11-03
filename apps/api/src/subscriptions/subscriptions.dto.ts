import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

const durations = [1, 3, 6, 12] as const;

export class CreateSubscriptionOrderDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,23}$/) planCode!: string;
  @IsInt() @IsIn(durations) durationMonths!: (typeof durations)[number];
}

export class CreateManualPaymentSubmissionDto {
  @IsOptional() @IsString() @MaxLength(120) @Matches(/^[^\u0000-\u001f\u007f]*$/) trackingCode?: string;
}

export class UpdateManualPaymentSettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Matches(/^(?:[0-9۰-۹٠-٩][\s-]*){16}$/) cardNumber!: string;
  @IsString() @MinLength(2) @MaxLength(120) cardHolder!: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string | null;
  @IsString() @Matches(/^@[A-Za-z0-9_]{5,32}$/) telegramContactHandle!: string;
  @IsString() @Matches(/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})?$/) telegramTargetChatId!: string;
}

export class CreateSubscriptionPlanDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,23}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(80) nameFa!: string;
  @IsInt() @Min(0) @Max(9999) displayOrder!: number;
  @IsOptional() @IsString() @MaxLength(80) badge?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) features?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSubscriptionPlanDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) nameFa?: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) displayOrder?: number;
  @IsOptional() @IsString() @MaxLength(80) badge?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) features?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateSubscriptionPriceDto {
  @IsInt() @IsIn(durations) durationMonths!: (typeof durations)[number];
  @IsString() @Matches(/^(0|[1-9]\d{0,17})$/) priceRial!: string;
  @IsDateString({ strict: true }) effectiveFrom!: string;
}

export class SubscriptionReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class SubscriptionGrantDto extends SubscriptionReasonDto {
  @IsInt() @IsIn(durations) durationMonths!: (typeof durations)[number];
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,23}$/) planCode?: string;
}

export class SubscriptionRolloutDto {
  @IsIn(["OBSERVE", "ENFORCE"]) mode!: "OBSERVE" | "ENFORCE";
  @IsOptional() @IsDateString({ strict: true }) legacyGraceEndsAt?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000) providerFeeBasisPoints?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBasisPoints?: number | null;
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,17})$/) variableCostRial?: string | null;
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,17})$/) minimumContributionRial?: string | null;
}
