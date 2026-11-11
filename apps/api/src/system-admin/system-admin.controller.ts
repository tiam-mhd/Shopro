import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { AdminPanelService } from "./admin-panel.service.js";
import { AdminListQueryDto, CreateBusinessAdminNoteDto, UpdateBusinessStatusDto } from "./admin-panel.dto.js";
import { SystemAdminService } from "./system-admin.service.js";

@SystemAdminOnly()
@Controller("system-admin")
export class SystemAdminController {
  constructor(private readonly service: SystemAdminService, private readonly panel: AdminPanelService) {}

  @Get("session")
  session(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) {
    return { admin: { id: admin.id, username: admin.username, displayName: admin.displayName }, csrfToken: request.cookies?.shopro_admin_csrf ?? null };
  }

  @Get("dashboard")
  dashboard(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query() query: Record<string, string | undefined>) {
    return this.panel.dashboard(admin, request, query);
  }

  @Get("overview")
  overview(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) {
    return this.service.overview(admin, request);
  }

  @Post("businesses/query") @HttpCode(HttpStatus.OK)
  businesses(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() query: AdminListQueryDto) {
    return this.panel.businesses(admin, request, query);
  }

  @Get("businesses/:id")
  businessDetail(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string) {
    return this.panel.businessDetail(admin, request, id);
  }

  @Patch("businesses/:id/status")
  updateBusinessStatus(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateBusinessStatusDto) {
    return this.panel.updateBusinessStatus(admin, request, id, dto.isActive, dto.reason, dto.currentPassword);
  }

  @Post("businesses/:id/notes")
  addBusinessNote(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateBusinessAdminNoteDto) {
    return this.panel.addBusinessNote(admin, request, id, dto.note);
  }

  @Post("storefront-orders/query") @HttpCode(HttpStatus.OK)
  storefrontOrders(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() query: AdminListQueryDto) {
    return this.panel.storefrontOrders(admin, request, query);
  }

  @Post("search") @HttpCode(HttpStatus.OK)
  globalSearch(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() query: AdminListQueryDto) {
    return this.panel.globalSearch(admin, request, query.q);
  }

  @Post("audit/query") @HttpCode(HttpStatus.OK)
  audit(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Body() query: AdminListQueryDto) {
    return this.panel.auditEvents(admin, request, query);
  }

  @Post("exports/:dataset")
  async export(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("dataset") dataset: string, @Body() query: AdminListQueryDto, @Res() response: Response) {
    const result = await this.panel.exportCsv(admin, request, dataset, query);
    response.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.status(200).send(result.csv);
  }
}
