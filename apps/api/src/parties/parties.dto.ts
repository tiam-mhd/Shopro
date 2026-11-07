import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";

export class PartyFieldsDto {
  @IsString() @Length(2, 160)
  name!: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  nationalId?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string | null;
}

export class CreatePartyDto extends PartyFieldsDto {
  @IsEnum(["CUSTOMER", "SUPPLIER", "BOTH"])
  type!: "CUSTOMER" | "SUPPLIER" | "BOTH";

  @IsOptional() @IsString() @MaxLength(24)
  creditLimitRial?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650)
  paymentTermsDays?: number;
}

export class CreateCustomerDto extends PartyFieldsDto {
  @IsOptional() @IsString() @MaxLength(24)
  creditLimitRial?: string;
}

export class CreateSupplierDto extends PartyFieldsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650)
  paymentTermsDays?: number;
}

export class UpdatePartyFieldsDto {
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @Length(2, 160)
  name?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  nationalId?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string | null;
}

export class UpdatePartyDto extends UpdatePartyFieldsDto {
  @IsOptional() @IsEnum(["CUSTOMER", "SUPPLIER", "BOTH"])
  type?: "CUSTOMER" | "SUPPLIER" | "BOTH";

  @IsOptional() @IsString() @MaxLength(24)
  creditLimitRial?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650)
  paymentTermsDays?: number | null;
}

export class UpdateCustomerDto extends UpdatePartyFieldsDto {
  @IsOptional() @IsString() @MaxLength(24)
  creditLimitRial?: string | null;
}

export class UpdateSupplierDto extends UpdatePartyFieldsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650)
  paymentTermsDays?: number | null;
}
