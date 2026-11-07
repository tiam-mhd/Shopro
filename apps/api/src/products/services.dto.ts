import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class CreateServiceDto {
  @IsString() @Length(1, 160) name!: string;
  @IsOptional() @IsString() @Length(1, 100) unitId?: string;
  @IsOptional() @IsString() @Length(1, 100) categoryId?: string;
  @IsString() @Length(1, 24) salePriceRial!: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBasisPoints?: number;
  @IsOptional() @IsString() @Length(0, 1000) description?: string;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() @Length(1, 160) name?: string;
  @IsOptional() @IsString() @Length(1, 100) unitId?: string;
  @IsOptional() @IsString() @Length(1, 100) categoryId?: string | null;
  @IsOptional() @IsString() @Length(1, 24) salePriceRial?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxRateBasisPoints?: number;
  @IsOptional() @IsString() @Length(0, 1000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCatalogCategoryDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @Length(1, 100) parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
