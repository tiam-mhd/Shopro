import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CreateStockCountDto } from "./inventory.dto.js";
import { InventoryService } from "./inventory.service.js";

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get("levels") levels(@CurrentUser() user: AuthenticatedUser) { return this.inventory.levels(user); }
  @Get("movements") movements(@CurrentUser() user: AuthenticatedUser, @Query("productId") productId?: string) { return this.inventory.movements(user, productId); }
  @Get("counts") counts(@CurrentUser() user: AuthenticatedUser) { return this.inventory.counts(user); }
  @Post("counts") createCount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockCountDto, @Req() request: AppRequest) { return this.inventory.createCount(user, dto, request); }
  @Patch("counts/:id") updateCount(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreateStockCountDto, @Req() request: AppRequest) { return this.inventory.updateCountDraft(user, id, dto, request); }
  @Delete("counts/:id") deleteCount(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Req() request: AppRequest) { return this.inventory.deleteCountDraft(user, id, request); }
  @Post("counts/:id/post") postCount(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.inventory.postCount(user, id, key, request); }
}
