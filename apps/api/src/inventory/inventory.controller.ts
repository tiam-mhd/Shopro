import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CreateStockCountDto } from "./inventory.dto.js";
import { InventoryService } from "./inventory.service.js";

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get("levels") levels(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.inventory.levels(user, cursor, limit); }
  @Get("movements") movements(@CurrentUser() user: AuthenticatedUser, @Query("productId") productId?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.inventory.movements(user, productId, cursor, limit); }
  @Get("counts") counts(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.inventory.counts(user, cursor, limit); }
  @Get("counts/:id") count(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.inventory.count(user, id); }
  @Post("counts") createCount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockCountDto, @Req() request: AppRequest) { return this.inventory.createCount(user, dto, request); }
  @Patch("counts/:id") updateCount(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateStockCountDto, @Req() request: AppRequest) { return this.inventory.updateCountDraft(user, id, dto, request); }
  @Delete("counts/:id") deleteCount(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Req() request: AppRequest) { return this.inventory.deleteCountDraft(user, id, request); }
  @Post("counts/:id/post") postCount(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.inventory.postCount(user, id, key, request); }
}
