import { Controller, Get, Query, Req } from "@nestjs/common";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { SystemAdminService } from "./system-admin.service.js";

@SystemAdminOnly()
@Controller("system-admin")
export class SystemAdminController {
  constructor(private readonly service: SystemAdminService) {}

  @Get("session")
  session(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) {
    return { admin: { id: admin.id, phone: admin.phone, displayName: admin.displayName }, csrfToken: request.cookies?.shopro_admin_csrf ?? null };
  }

  @Get("overview")
  overview(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) {
    return this.service.overview(admin, request);
  }

  @Get("businesses")
  businesses(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("q") q?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.service.businesses(admin, request, { q, cursor, limit });
  }

  @Get("audit")
  audit(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.service.audit(admin, request, cursor, limit);
  }
}
