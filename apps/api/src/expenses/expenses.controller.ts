import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CreateExpenseCategoryDto, CreateExpenseDto, PostExpenseDto, VoidExpenseDto } from "./expenses.dto.js";
import { ExpensesService } from "./expenses.service.js";

@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.expenses.list(user); }
  @Get("categories") categories(@CurrentUser() user: AuthenticatedUser) { return this.expenses.categories(user); }
  @Post("categories") createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseCategoryDto, @Req() request: AppRequest) { return this.expenses.createCategory(user, dto, request); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.expenses.get(user, id); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseDto, @Req() request: AppRequest) { return this.expenses.create(user, dto, request); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreateExpenseDto, @Req() request: AppRequest) { return this.expenses.updateDraft(user, id, dto, request); }
  @Delete(":id") remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Req() request: AppRequest) { return this.expenses.deleteDraft(user, id, request); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: PostExpenseDto, @Headers("idempotency-key") key?: string, @Req() request?: AppRequest) { return this.expenses.post(user, id, dto, key, request); }
  @Post(":id/void") void(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: VoidExpenseDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.expenses.void(user, id, dto, key, request); }
}
