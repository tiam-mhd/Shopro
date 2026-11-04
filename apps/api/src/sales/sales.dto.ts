import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsDefined, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class SalesLineDto {
  @IsUUID()
  productId!: string;

  @IsString() @Length(1, 32)
  quantity!: string;

  @IsOptional() @IsString() @Length(1, 24)
  unitPriceRial?: string;

  @IsOptional() @IsString() @Length(1, 24)
  discountRial?: string;
}

export class SalesPaymentDto {
  @IsString() @Length(1, 24)
  amountRial!: string;

  @IsString() @IsUUID()
  financeAccountId!: string;

  @IsString() @IsIn(["CASH", "POS", "BANK", "OTHER"])
  method!: "CASH" | "POS" | "BANK" | "OTHER";
}

export class CreateSalesDto {
  @IsOptional() @IsUUID()
  customerId?: string;

  @IsString() @Length(10, 10)
  txnDate!: string;

  @IsOptional() @IsString() @Length(0, 1000)
  note?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SalesLineDto)
  lines!: SalesLineDto[];
}

export class PostSalesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SalesPaymentDto)
  payments?: SalesPaymentDto[];
}

export class SyncSaleOperationDto {
  @IsDefined() @IsUUID()
  clientOperationId!: string;

  @IsDefined() @IsUUID()
  deviceId!: string;

  @IsDefined() @Equals("SALE_CREATE_AND_POST")
  operationType!: "SALE_CREATE_AND_POST";

  @IsDefined() @ValidateNested() @Type(() => CreateSalesDto)
  sale!: CreateSalesDto;

  @IsOptional() @ValidateNested() @Type(() => SalesPaymentDto)
  payment?: SalesPaymentDto;

  @IsOptional() @IsBoolean()
  retryFailed?: boolean;
}

export class VoidSalesDto {
  @IsString() @Length(3, 500)
  reason!: string;
}

export class SalesReturnLineDto {
  @IsUUID()
  invoiceLineId!: string;

  @IsString() @Length(1, 32)
  quantity!: string;

  @IsBoolean()
  restock!: boolean;
}

export class CreateSalesReturnDto {
  @IsString() @Length(10, 10)
  txnDate!: string;

  @IsString() @Length(3, 500)
  reason!: string;

  @IsOptional() @IsString() @Length(1, 24)
  cashRefundRial?: string;

  @IsOptional() @IsUUID()
  refundFinanceAccountId?: string;

  @IsOptional() @IsString() @Length(3, 8)
  refundMethod?: "CASH" | "POS" | "BANK" | "OTHER";

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SalesReturnLineDto)
  lines!: SalesReturnLineDto[];
}
