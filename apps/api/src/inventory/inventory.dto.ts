import { ArrayMinSize, IsArray, IsString, IsUUID, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class StockCountLineDto {
  @IsUUID()
  productId!: string;

  @IsString() @Length(1, 32)
  countedQuantity!: string;
}

export class CreateStockCountDto {
  @IsString() @Length(10, 10)
  txnDate!: string;

  @IsString() @Length(3, 500)
  reason!: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StockCountLineDto)
  lines!: StockCountLineDto[];
}
