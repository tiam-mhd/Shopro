import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/public.decorator.js";
import type { AppRequest } from "../common/request-context.js";
import { AuthService } from "./auth.service.js";
import { RequestOtpDto, VerifyOtpDto } from "./otp.dto.js";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import type { AuthenticatedSystemAdmin } from "../common/request-context.js";

const cookieOptions = (expires: Date) => ({ httpOnly: true, secure: process.env.COOKIE_SECURE === "true", sameSite: "strict" as const, path: "/api/v1/system-admin", expires });

@Controller("system-admin/auth")
export class SystemAdminAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post("otp/request") @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() body: RequestOtpDto, @Req() request: AppRequest) {
    await this.auth.requestOtp(body.phone, "ADMIN_LOGIN", request.ip, request.requestId);
    return { ok: true, message: "اگر شمارهٔ مدیر سامانه فعال باشد، کد ورود ارسال می‌شود." };
  }

  @Public() @Post("otp/verify") @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.verifyAdminOtp(body.phone, body.code);
    response.cookie("shopro_admin_session", result.rawSession, cookieOptions(result.expiresAt));
    response.cookie("shopro_admin_csrf", result.rawCsrf, { ...cookieOptions(result.expiresAt), httpOnly: false });
    return { admin: result.admin };
  }

  @SystemAdminOnly() @Post("logout") @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Res({ passthrough: true }) response: Response) {
    await this.auth.logoutAdmin(admin.sessionId);
    response.clearCookie("shopro_admin_session", { path: "/api/v1/system-admin", sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" });
    response.clearCookie("shopro_admin_csrf", { path: "/api/v1/system-admin", sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" });
  }
}
