import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { ReportsService } from "./reports.service.js";

@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get("dashboard") dashboard(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) { return this.reports.dashboard(user, from, to); }
  @Get("sales") sales(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) { return this.reports.dashboard(user, from, to); }
  @Get("profit-loss") profitLoss(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) { return this.reports.profitLoss(user, from, to); }
  @Get("cash-flow") cashFlow(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) { return this.reports.cashFlow(user, from, to); }
  @Get("receivables") receivables(@CurrentUser() user: AuthenticatedUser) { return this.reports.partyBalances(user, "receivable"); }
  @Get("payables") payables(@CurrentUser() user: AuthenticatedUser) { return this.reports.partyBalances(user, "payable"); }
  @Get("inventory") inventory(@CurrentUser() user: AuthenticatedUser) { return this.reports.inventory(user); }
  @Get("trial-balance") trialBalance(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) { return this.reports.trialBalance(user, from, to); }
}
