import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class CreateProductDto {
  @IsString() @Length(1, 160)
  name!: string;

  @IsOptional() @IsString() @Length(1, 48)
  sku?: string;

  @IsOptional() @IsString() @Length(4, 64)
  barcode?: string;

  @IsIn(["STOCK", "SERVICE"])
  kind!: "STOCK" | "SERVICE";

  @IsOptional() @IsString() @Length(1, 100)
  unitId?: string;

  @IsOptional() @IsString() @Length(1, 100)
  categoryId?: string;

  @IsString() @Length(1, 24)
  salePriceRial!: string;

  @IsOptional() @IsString() @Length(1, 24)
  defaultCostRial?: string;

  @IsOptional() @IsString() @Length(1, 30)
  reorderPoint?: string;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  taxRateBasisPoints?: number;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 160)
  name?: string;
  @IsOptional() @IsString() @Length(1, 48)
  sku?: string | null;
  @IsOptional() @IsString() @Length(4, 64)
  barcode?: string | null;
  @IsOptional() @IsString() @Length(1, 100)
  unitId?: string;
  @IsOptional() @IsString() @Length(1, 100)
  categoryId?: string | null;
  @IsOptional() @IsString() @Length(1, 24)
  salePriceRial?: string;
  @IsOptional() @IsString() @Length(1, 24)
  defaultCostRial?: string | null;
  @IsOptional() @IsString() @Length(1, 30)
  reorderPoint?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(10000)
  taxRateBasisPoints?: number;
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class CreateProductCategoryDto {
  @IsString() @Length(2, 100)
  name!: string;
}

export class UpdateUnitsVisibilityDto {
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID("4", { each: true })
  visibleUnitIds!: string[];
}
