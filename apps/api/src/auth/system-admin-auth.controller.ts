import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/public.decorator.js";
import type { AppRequest } from "../common/request-context.js";
import { AuthService } from "./auth.service.js";
import { RequestOtpDto, VerifyOtpDto } from "./otp.dto.js";

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
}
