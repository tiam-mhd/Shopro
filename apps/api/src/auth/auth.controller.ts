import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../common/public.decorator.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { AuthService } from "./auth.service.js";
import { RequestOtpDto, VerifyOtpDto } from "./otp.dto.js";

const cookieOptions = (expires: Date) => ({ httpOnly: true, secure: process.env.COOKIE_SECURE === "true", sameSite: "strict" as const, path: "/", expires });
const csrfOptions = (expires: Date) => ({ httpOnly: false, secure: process.env.COOKIE_SECURE === "true", sameSite: "strict" as const, path: "/", expires });

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post("otp/request") @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() body: RequestOtpDto, @Req() request: Request) {
    await this.auth.requestOtp(body.phone, "USER_LOGIN", request.ip);
    return { ok: true, message: "اگر شماره معتبر باشد، کد ورود ارسال می‌شود." };
  }

  @Public() @Post("otp/verify") @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.verifyUserOtp(body.phone, body.code);
    response.cookie("shopro_session", result.rawSession, cookieOptions(result.expiresAt));
    response.cookie("shopro_csrf", result.rawCsrf, csrfOptions(result.expiresAt));
    return { user: result.user };
  }

  @Get("session")
  async session(@CurrentUser() user: AuthenticatedUser) {
    const { sessionId, csrfHash, ...safeUser } = user;
    return { user: safeUser };
  }

  @Post("logout") @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    await this.auth.logoutUser(user.sessionId);
    response.clearCookie("shopro_session", { path: "/", sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" });
    response.clearCookie("shopro_csrf", { path: "/", sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" });
  }
}
