import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CreatePurchaseDto, PostPurchaseDto } from "./purchases.dto.js";
import { PurchasesService } from "./purchases.service.js";

@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.purchases.list(user); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseDto, @Req() request: AppRequest) { return this.purchases.create(user, dto, request); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest, @Body() dto: PostPurchaseDto) { return this.purchases.post(user, id, dto, key, request); }
}
