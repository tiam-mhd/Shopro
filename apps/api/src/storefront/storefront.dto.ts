import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class StorefrontSettingsDto {
  @IsString() @Length(1, 120) publicName!: string;
  @IsString() @Length(3, 80) slug!: string;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @IsOptional() @IsString() @Length(8, 16) phone?: string;
  @IsOptional() @IsString() @Length(0, 500) address?: string;
  @IsBoolean() showAddress!: boolean;
  @IsBoolean() acceptsPickup!: boolean;
  @IsBoolean() acceptsLocalDelivery!: boolean;
  @IsString() @Length(1, 20) deliveryFeeRial!: string;
  @IsBoolean() showExactStock!: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_080) preparationMinutes?: number;
  @IsOptional() @IsString() @Length(0, 1000) paymentInstructions?: string;
  @IsOptional() @IsString() @Length(0, 1000) cancellationPolicy?: string;
  @IsIn(["DRAFT", "PUBLISHED", "PAUSED"]) status!: "DRAFT" | "PUBLISHED" | "PAUSED";
}

export class StorefrontListingDto {
  @IsString() @Length(1, 160) publicTitle!: string;
  @IsOptional() @IsString() @Length(0, 1000) publicDescription?: string;
  @IsOptional() @IsString() @Length(1, 20) publicPriceRial?: string;
  @IsBoolean() isPublished!: boolean;
  @IsBoolean() canOrder!: boolean;
  @IsIn(["EXACT", "APPROXIMATE", "INQUIRY"]) stockPolicy!: "EXACT" | "APPROXIMATE" | "INQUIRY";
  @IsString() @Length(1, 32) minimumQuantity!: string;
  @IsOptional() @IsString() @Length(1, 32) maximumQuantity?: string;
  @IsInt() @Min(0) @Max(100_000) displayOrder!: number;
}

export class CreateStorePaymentCardDto {
  @IsUUID() financeAccountId!: string;
  @IsString() @Length(2, 80) bankName!: string;
  @IsString() @Length(2, 120) holderName!: string;
  @IsString() @Length(16, 23) cardNumber!: string;
  @IsOptional() @IsString() @Length(0, 80) label?: string;
  @IsOptional() @IsString() @Length(0, 500) instructions?: string;
  @IsInt() @Min(0) @Max(100_000) displayOrder!: number;
}

export class SetStorePaymentCardActiveDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) displayOrder?: number;
}

export class StorefrontOtpDto {
  @IsString() @Length(8, 16) phone!: string;
}

export class VerifyStorefrontOtpDto extends StorefrontOtpDto {
  @IsString() @Length(4, 8) code!: string;
}

export class StorefrontOrderLineDto {
  @IsUUID() listingId!: string;
  @IsString() @Length(1, 32) quantity!: string;
  @IsString() @Length(1, 20) expectedUnitPriceRial!: string;
  @IsInt() @Min(0) @Max(10_000) expectedTaxRateBasisPoints!: number;
}

export class CreateStorefrontOrderDto {
  @IsString() @Length(2, 120) customerName!: string;
  @IsString() @Length(8, 16) customerPhone!: string;
  @IsString() @Length(20, 128) checkoutToken!: string;
  @IsIn(["PICKUP", "LOCAL_DELIVERY"]) deliveryMethod!: "PICKUP" | "LOCAL_DELIVERY";
  @IsOptional() @IsString() @Length(5, 500) deliveryAddress?: string;
  @IsOptional() @IsString() @Length(0, 500) customerNote?: string;
  @IsString() @Length(1, 20) expectedTotalRial!: string;
  @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StorefrontOrderLineDto)
  lines!: StorefrontOrderLineDto[];
}

export class CreateStorefrontReceiptDto {
  @IsUUID() cardId!: string;
  @IsString() @Length(1, 20) submittedAmountRial!: string;
  @IsOptional() @IsString() @Length(1, 120) customerTransactionReference?: string;
  @IsOptional() @IsString() @Length(10, 35) transferredAt?: string;
  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class VerifyStorefrontPaymentDto {
  @IsString() @Length(1, 20) verifiedAmountRial!: string;
  @IsString() @Length(3, 120) transactionReference!: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class ResolveStorefrontOverpaymentDto {
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class RejectStorefrontPaymentDto {
  @IsString() @Length(3, 500) reason!: string;
}

export class RejectStorefrontOrderDto {
  @IsString() @Length(3, 500) reason!: string;
}

export class TransitionStorefrontOrderDto {
  @IsIn(["PREPARING", "READY", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"]) status!: "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "READY_FOR_PICKUP" | "COMPLETED" | "CANCELLED";
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
  @IsOptional() @IsString() @Length(0, 500) customerMessage?: string;
}
