import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { Public } from "../common/public.decorator.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import { ADMIN_CSRF_COOKIE, ADMIN_SESSION_COOKIE } from "../common/admin-session-cookie.js";
import { SystemAdminChangePasswordDto, SystemAdminLoginDto, SystemAdminRevokeSessionsDto } from "./system-admin-auth.dto.js";
import { SystemAdminAuthService } from "./system-admin-auth.service.js";

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true",
  sameSite: "strict" as const,
  path: "/",
  expires,
});

const clearOptions = { path: "/", sameSite: "strict" as const, secure: process.env.COOKIE_SECURE === "true" };

@SystemAdminOnly()
@Controller("system-admin/auth")
export class SystemAdminAuthController {
  constructor(private readonly auth: SystemAdminAuthService) {}

  @Public() @Post("login") @HttpCode(HttpStatus.OK)
  async login(@Body() body: SystemAdminLoginDto, @Req() request: AppRequest, @Res({ passthrough: true }) response: Response) {
    const { rawSession, rawCsrf, expiresAt, ...result } = await this.auth.login(body, request);
    response.cookie(ADMIN_SESSION_COOKIE, rawSession, cookieOptions(expiresAt));
    response.cookie(ADMIN_CSRF_COOKIE, rawCsrf, { ...cookieOptions(expiresAt), httpOnly: false });
    return result;
  }

  @Post("logout") @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(admin, request);
    response.clearCookie(ADMIN_SESSION_COOKIE, clearOptions);
    response.clearCookie(ADMIN_CSRF_COOKIE, clearOptions);
    if (ADMIN_SESSION_COOKIE !== "shopro_admin_session") response.clearCookie("shopro_admin_session", clearOptions);
  }

  @Patch("change-password") @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Body() body: SystemAdminChangePasswordDto, @Req() request: AppRequest, @Res({ passthrough: true }) response: Response) {
    const { rawSession, rawCsrf, expiresAt, ...result } = await this.auth.changePassword(admin, body, request);
    response.cookie(ADMIN_SESSION_COOKIE, rawSession, cookieOptions(expiresAt));
    response.cookie(ADMIN_CSRF_COOKIE, rawCsrf, { ...cookieOptions(expiresAt), httpOnly: false });
    return result;
  }

  @Get("sessions")
  sessions(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest) {
    return this.auth.activeSessions(admin, request);
  }

  @Post("revoke-sessions") @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSessions(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Body() body: SystemAdminRevokeSessionsDto, @Req() request: AppRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.revokeAllSessions(admin, body.currentPassword, request);
    response.clearCookie(ADMIN_SESSION_COOKIE, clearOptions);
    response.clearCookie(ADMIN_CSRF_COOKIE, clearOptions);
    if (ADMIN_SESSION_COOKIE !== "shopro_admin_session") response.clearCookie("shopro_admin_session", clearOptions);
  }
}
