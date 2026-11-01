import { IsOptional, IsString, Length, Max, Min, IsInt } from "class-validator";

export class CreateExpenseDto {
  @IsString() @Length(1, 24)
  amountRial!: string;
  @IsString() @Length(1, 100)
  categoryId!: string;
  @IsOptional() @IsString() @Length(1, 100)
  payeeId?: string;
  @IsOptional() @IsString() @Length(10, 10)
  txnDate?: string;
  @IsOptional() @IsString() @Length(0, 1000)
  note?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000)
  taxRateBasisPoints?: number;
}

export class CreateExpenseCategoryDto {
  @IsString() @Length(2, 100)
  name!: string;
}

export class PostExpenseDto {
  @IsOptional() @IsString() @Length(1, 100)
  financeAccountId?: string;
}

export class VoidExpenseDto {
  @IsString() @Length(3, 500)
  reason!: string;
}
