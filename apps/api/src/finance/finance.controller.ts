import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CashCloseDto, CashTransactionDto, ClosePeriodDto, CreateFinanceAccountDto, ReopenPeriodDto, TransferDto, UpdateFinanceAccountDto, VoidFinanceTransactionDto } from "./finance.dto.js";
import { FinanceService } from "./finance.service.js";

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}
  @Get("finance/accounts") accounts(@CurrentUser() user: AuthenticatedUser) { return this.finance.accounts(user); }
  @Get("finance/accounts/:id") account(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.finance.getAccount(user, id); }
  @Post("finance/accounts") createAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFinanceAccountDto, @Req() request: AppRequest) { return this.finance.createAccount(user, dto, request); }
  @Patch("finance/accounts/:id") updateAccount(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateFinanceAccountDto, @Req() request: AppRequest) { return this.finance.updateAccount(user, id, dto, request); }
  @Get("finance/transactions") transactions(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) { return this.finance.transactions(user, Number(limit ?? 100)); }
  @Post("finance/transactions/:id/void") voidTransaction(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: VoidFinanceTransactionDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.finance.voidTransaction(user, id, dto, key, request); }
  @Get("finance/cash-closes") cashCloses(@CurrentUser() user: AuthenticatedUser, @Query("limit") limit?: string) { return this.finance.cashCloses(user, Number(limit ?? 50)); }
  @Post("finance/cash-closes") cashClose(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashCloseDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.finance.cashClose(user, dto, key, request); }
  @Get("finance/closed-periods") closedPeriods(@CurrentUser() user: AuthenticatedUser) { return this.finance.closedPeriods(user); }
  @Post("finance/closed-periods") closePeriod(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClosePeriodDto, @Req() request: AppRequest) { return this.finance.closePeriod(user, dto, request); }
  @Post("finance/closed-periods/:id/reopen") reopenPeriod(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: ReopenPeriodDto, @Req() request: AppRequest) { return this.finance.reopenPeriod(user, id, dto, request); }
  @Post("cash-transactions/receipts") receipt(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashTransactionDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.finance.receipt(user, dto, key, request); }
  @Post("cash-transactions/payments") payment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashTransactionDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.finance.payment(user, dto, key, request); }
  @Post("cash-transactions/transfers") transfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: TransferDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.finance.transfer(user, dto, key, request); }
}
