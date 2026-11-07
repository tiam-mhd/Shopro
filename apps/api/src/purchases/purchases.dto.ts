import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class PurchaseLineDto {
  @IsUUID()
  productId!: string;
  @IsString() @Length(1, 32)
  quantity!: string;
  @IsString() @Length(1, 24)
  unitCostRial!: string;
  @IsOptional() @IsString() @Length(1, 24)
  discountRial?: string;
}

export class PurchasePaymentDto {
  @IsString() @Length(1, 24)
  amountRial!: string;
  @IsUUID()
  financeAccountId!: string;
  @IsString() @Length(3, 8)
  method!: "CASH" | "POS" | "BANK" | "OTHER";
}

export class CreatePurchaseDto {
  @IsOptional() @IsUUID()
  supplierId?: string;
  @IsString() @Length(10, 10)
  txnDate!: string;
  @IsOptional() @IsString() @Length(10, 10)
  dueDate?: string;
  @IsOptional() @IsString() @Length(0, 1000)
  note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class PostPurchaseDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PurchasePaymentDto)
  payments?: PurchasePaymentDto[];
}

export class VoidPurchaseDto {
  @IsString() @Length(3, 500)
  reason!: string;
}
