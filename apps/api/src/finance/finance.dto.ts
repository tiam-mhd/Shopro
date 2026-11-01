import { IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";

export class CreateFinanceAccountDto {
  @IsString() @Length(2, 100)
  name!: string;
  @IsIn(["CASH", "BANK", "POS", "OTHER"])
  kind!: "CASH" | "BANK" | "POS" | "OTHER";
}

export class CashTransactionDto {
  @IsString() @Length(1, 24)
  amountRial!: string;
  @IsString() @Length(1, 100)
  financeAccountId!: string;
  @IsOptional() @IsString() @Length(1, 100)
  partyId?: string;
  @IsIn(["CASH", "POS", "BANK", "OTHER"])
  method!: "CASH" | "POS" | "BANK" | "OTHER";
  @IsOptional() @IsString() @Length(1, 120)
  reference?: string;
  @IsOptional() @IsString() @Length(10, 10)
  txnDate?: string;
}

export class TransferDto {
  @IsString() @Length(1, 24)
  amountRial!: string;
  @IsString() @Length(1, 100)
  fromFinanceAccountId!: string;
  @IsString() @Length(1, 100)
  toFinanceAccountId!: string;
  @IsOptional() @IsString() @Length(1, 120)
  reference?: string;
  @IsOptional() @IsString() @Length(10, 10)
  txnDate?: string;
}

export class CashCloseDto {
  @IsUUID()
  financeAccountId!: string;

  @IsString() @Length(10, 10)
  closeDate!: string;

  @IsString() @Length(1, 24)
  countedBalanceRial!: string;

  @IsOptional() @IsString() @Length(1, 500)
  note?: string;
}

export class ClosePeriodDto {
  @IsString() @Length(10, 10)
  startDate!: string;

  @IsString() @Length(10, 10)
  endDate!: string;

  @IsString() @Length(3, 500)
  reason!: string;
}

export class ReopenPeriodDto {
  @IsString() @Length(3, 500)
  reason!: string;
}
