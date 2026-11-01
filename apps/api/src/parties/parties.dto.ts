import { IsBoolean, IsEnum, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class CreatePartyDto {
  @IsEnum(["CUSTOMER", "SUPPLIER", "BOTH"])
  type!: "CUSTOMER" | "SUPPLIER" | "BOTH";

  @IsString() @Length(2, 160)
  name!: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;
}

export class UpdatePartyDto {
  @IsOptional() @IsEnum(["CUSTOMER", "SUPPLIER", "BOTH"])
  type?: "CUSTOMER" | "SUPPLIER" | "BOTH";

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @Length(2, 160)
  name?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string | null;
}
