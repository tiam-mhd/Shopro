import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CreatePurchaseDto, PostPurchaseDto, VoidPurchaseDto } from "./purchases.dto.js";
import { PurchasesService } from "./purchases.service.js";

@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.purchases.list(user); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.purchases.get(user, id); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseDto, @Req() request: AppRequest) { return this.purchases.create(user, dto, request); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreatePurchaseDto, @Req() request: AppRequest) { return this.purchases.updateDraft(user, id, dto, request); }
  @Delete(":id") remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Req() request: AppRequest) { return this.purchases.deleteDraft(user, id, request); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest, @Body() dto: PostPurchaseDto) { return this.purchases.post(user, id, dto, key, request); }
  @Post(":id/void") void(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: VoidPurchaseDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.purchases.void(user, id, dto, key, request); }
}
