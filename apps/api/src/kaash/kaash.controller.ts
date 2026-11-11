import { Body, Controller, Header, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { SubmitKaashDto } from "./kaash.dto.js";
import { KaashService } from "./kaash.service.js";

@Controller("kaash")
export class KaashController {
  constructor(private readonly service: KaashService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "private, no-store")
  submit(@CurrentUser() user: AuthenticatedUser, @Req() request: AppRequest, @Body() dto: SubmitKaashDto) {
    return this.service.submit(user, request, dto);
  }
}
