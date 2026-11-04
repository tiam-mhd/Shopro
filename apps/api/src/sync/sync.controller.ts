import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { SyncService } from "./sync.service.js";
import { SyncSaleOperationDto } from "../sales/sales.dto.js";

@Controller("sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post("operations")
  operation(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncSaleOperationDto, @Req() request: AppRequest) {
    return this.sync.submitSale(user, dto, request);
  }

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.sync.status(user, cursor, limit);
  }
}
