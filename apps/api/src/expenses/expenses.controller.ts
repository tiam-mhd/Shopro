import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CreateExpenseDto, PostExpenseDto } from "./expenses.dto.js";
import { ExpensesService } from "./expenses.service.js";

@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.expenses.list(user); }
  @Get("categories") categories(@CurrentUser() user: AuthenticatedUser) { return this.expenses.categories(user); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto, @Req() request: AppRequest) { return this.expenses.create(user, dto, request); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: PostExpenseDto, @Headers("idempotency-key") key?: string, @Req() request?: AppRequest) { return this.expenses.post(user, id, dto, key, request); }
}
