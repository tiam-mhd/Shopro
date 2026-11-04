import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsOptional, IsString, Length, Matches } from "class-validator";

export class CreateBusinessDto {
  @IsString() @Length(2, 160)
  displayName!: string;

  @IsOptional() @IsString() @Length(2, 80)
  businessType?: string;

  @IsString() @Length(2, 120)
  initialBranchName!: string;

  @IsOptional() @IsEnum(["IRR", "IRT"])
  displayCurrency?: "IRR" | "IRT";
}

export class CreateBranchDto {
  @IsString() @Length(2, 120)
  name!: string;

  @IsString() @Length(2, 24) @Matches(/^[a-zA-Z0-9_-]+$/)
  code!: string;
}

export class UpdateBusinessDto {
  @IsOptional() @IsString() @Length(2, 160)
  displayName?: string;

  @IsOptional() @IsEnum(["IRR", "IRT"])
  displayCurrency?: "IRR" | "IRT";
}

export class AddMemberDto {
  @IsString() @Length(8, 16)
  phone!: string;

  @IsEnum(["MANAGER", "ACCOUNTANT", "CASHIER", "VIEWER"])
  role!: "MANAGER" | "ACCOUNTANT" | "CASHIER" | "VIEWER";

  @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true })
  branchIds!: string[];
}

export class UpdateMemberDto {
  @IsOptional() @IsEnum(["MANAGER", "ACCOUNTANT", "CASHIER", "VIEWER"])
  role?: "MANAGER" | "ACCOUNTANT" | "CASHIER" | "VIEWER";

  @IsOptional() @IsEnum(["ACTIVE", "SUSPENDED"])
  status?: "ACTIVE" | "SUSPENDED";

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true })
  branchIds?: string[];
}
