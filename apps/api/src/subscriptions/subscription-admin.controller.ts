import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { CreateSubscriptionPlanDto, CreateSubscriptionPriceDto, SubscriptionActionPreviewDto, SubscriptionGrantDto, SubscriptionReasonDto, SubscriptionRolloutDto, SubscriptionSensitiveReasonDto, UpdateSubscriptionPlanDto } from "./subscriptions.dto.js";
import { UpdateManualPaymentSettingsDto } from "./subscriptions.dto.js";
import { ManualPaymentsService } from "./manual-payments.service.js";
import { SubscriptionAdminService } from "./subscription-admin.service.js";

@SystemAdminOnly()
@Controller("system-admin/subscriptions")
export class SubscriptionAdminController {
  constructor(private readonly subscriptions: SubscriptionAdminService, private readonly manualPayments: ManualPaymentsService) {}

  @Get("plans") plans(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.subscriptions.plans(admin, request); }
  @Post("plans") createPlan(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() dto: CreateSubscriptionPlanDto) { return this.subscriptions.createPlan(admin, request, dto); }
  @Patch("plans/:id") updatePlan(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateSubscriptionPlanDto) { return this.subscriptions.updatePlan(admin, request, id, dto); }
  @Delete("plans/:id") deactivatePlan(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string) { return this.subscriptions.updatePlan(admin, request, id, { isActive: false }); }
  @Post("plans/:id/prices") addPrice(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateSubscriptionPriceDto) { return this.subscriptions.addPrice(admin, request, id, dto); }

  @Get("branches") branches(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("q") q?: string, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.subscriptions.branches(admin, request, { q, status, cursor, limit }); }
  @Post("branches/:branchId/preview") @HttpCode(HttpStatus.OK) previewBranchAction(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionActionPreviewDto) { return this.subscriptions.previewBranchAction(admin, request, branchId, dto); }
  @Post("branches/:branchId/grant") grant(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionGrantDto) { return this.subscriptions.grant(admin, request, branchId, dto); }
  @Post("branches/:branchId/extend") extend(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionGrantDto) { return this.subscriptions.grant(admin, request, branchId, dto, true); }
  @Post("branches/:branchId/suspend") suspend(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionSensitiveReasonDto) { return this.subscriptions.setSuspension(admin, request, branchId, dto, true); }
  @Post("branches/:branchId/unsuspend") unsuspend(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionSensitiveReasonDto) { return this.subscriptions.setSuspension(admin, request, branchId, dto, false); }
  @Post("branches/:branchId/revoke") revoke(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("branchId", UuidParamPipe) branchId: string, @Body() dto: SubscriptionSensitiveReasonDto) { return this.subscriptions.revoke(admin, request, branchId, dto); }

  @Get("orders") orders(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("q") q?: string, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.subscriptions.orders(admin, request, { q, status, cursor, limit }); }
  @Post("orders/:id/refund") refund(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: SubscriptionReasonDto) { return this.subscriptions.refund(admin, request, id, dto); }

  @Get("payment-settings") paymentSettings(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.manualPayments.settings(admin, request); }
  @Patch("payment-settings") updatePaymentSettings(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() dto: UpdateManualPaymentSettingsDto) { return this.manualPayments.updateSettings(admin, request, dto); }
  @Post("payment-settings/telegram/test") testTelegram(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.manualPayments.testTelegram(admin, request); }
  @Get("manual-payments") listManualPayments(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.manualPayments.submissions(admin, request, status, cursor, limit); }
  @Get("manual-payments/:id/receipt") async receipt(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Res() response: Response) {
    const file = await this.manualPayments.receipt(admin, request, id);
    const encodedName = encodeURIComponent(file.fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.set({ "Content-Type": file.mimeType, "Content-Length": String(file.bytes.byteLength), "Content-Disposition": `attachment; filename="receipt"; filename*=UTF-8''${encodedName}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    response.status(200).send(file.bytes);
  }
  @Post("manual-payments/:id/approve") approveManualPayment(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: SubscriptionReasonDto) { return this.manualPayments.approve(admin, request, id, dto.reason); }
  @Post("manual-payments/:id/reject") rejectManualPayment(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: SubscriptionReasonDto) { return this.manualPayments.reject(admin, request, id, dto.reason); }
  @Post("manual-payments/:id/telegram/retry") retryManualPaymentTelegram(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string) { return this.manualPayments.retryTelegram(admin, request, id); }

  @Get("rollout") rollout(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.subscriptions.rollout(admin, request); }
  @Patch("rollout") updateRollout(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() dto: SubscriptionRolloutDto) { return this.subscriptions.updateRollout(admin, request, dto); }
  @Get("economics") economics(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) { return this.subscriptions.economics(admin, request); }
}
