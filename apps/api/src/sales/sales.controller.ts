import { Body, Controller, Get, Headers, Param, Post, Query, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CreateSalesDto, CreateSalesReturnDto, PostSalesDto, VoidSalesDto } from "./sales.dto.js";
import { SalesService } from "./sales.service.js";

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("status") status?: string) { return this.sales.list(user, q, status); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalesDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.sales.createDraft(user, dto, key, request); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.sales.get(user, id); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: PostSalesDto, @Headers("idempotency-key") key?: string, @Req() request?: AppRequest) { return this.sales.post(user, id, dto, key, request); }
  @Post(":id/void") void(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: VoidSalesDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.sales.void(user, id, dto, key, request); }
  @Post(":id/returns") returnSale(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreateSalesReturnDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.sales.returnSale(user, id, dto, key, request); }
}
