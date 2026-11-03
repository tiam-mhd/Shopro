import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { CreateSubscriptionPlanDto, CreateSubscriptionPriceDto, SubscriptionGrantDto, SubscriptionReasonDto, SubscriptionRolloutDto, UpdateSubscriptionPlanDto } from "./subscriptions.dto.js";
import { SubscriptionAdminService } from "./subscription-admin.service.js";

@SystemAdminOnly()
@Controller("system-admin/subscriptions")
export class SubscriptionAdminController {
  constructor(private readonly subscriptions: SubscriptionAdminService) {}

  @Get("plans") plans(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.subscriptions.plans(admin, request); }
  @Post("plans") createPlan(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() dto: CreateSubscriptionPlanDto) { return this.subscriptions.createPlan(admin, request, dto); }
  @Patch("plans/:id") updatePlan(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateSubscriptionPlanDto) { return this.subscriptions.updatePlan(admin, request, id, dto); }
  @Delete("plans/:id") deactivatePlan(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string) { return this.subscriptions.updatePlan(admin, request, id, { isActive: false }); }
  @Post("plans/:id/prices") addPrice(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateSubscriptionPriceDto) { return this.subscriptions.addPrice(admin, request, id, dto); }

  @Get("branches") branches(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("q") q?: string, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.subscriptions.branches(admin, request, { q, status, cursor, limit }); }
  @Post("branches/:branchId/grant") grant(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionGrantDto) { return this.subscriptions.grant(admin, request, branchId, dto); }
  @Post("branches/:branchId/extend") extend(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionGrantDto) { return this.subscriptions.grant(admin, request, branchId, dto, true); }
  @Post("branches/:branchId/suspend") suspend(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionReasonDto) { return this.subscriptions.setSuspension(admin, request, branchId, dto, true); }
  @Post("branches/:branchId/unsuspend") unsuspend(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionReasonDto) { return this.subscriptions.setSuspension(admin, request, branchId, dto, false); }
  @Post("branches/:branchId/revoke") revoke(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionReasonDto) { return this.subscriptions.revoke(admin, request, branchId, dto); }

  @Get("orders") orders(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("q") q?: string, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.subscriptions.orders(admin, request, { q, status, cursor, limit }); }
  @Post("orders/:id/refund") refund(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: SubscriptionReasonDto) { return this.subscriptions.refund(admin, request, id, dto); }

  @Get("rollout") rollout(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.subscriptions.rollout(admin, request); }
  @Patch("rollout") updateRollout(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() dto: SubscriptionRolloutDto) { return this.subscriptions.updateRollout(admin, request, dto); }
  @Get("economics") economics(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.subscriptions.economics(admin, request); }
}
