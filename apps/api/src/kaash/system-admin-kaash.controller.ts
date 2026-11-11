import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from "@nestjs/common";
import { CurrentSystemAdmin } from "../common/current-system-admin.decorator.js";
import { SystemAdminOnly } from "../common/system-admin-only.decorator.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { AdminKaashListQueryDto, UpdateKaashDto } from "./kaash.dto.js";
import { KaashService } from "./kaash.service.js";

@SystemAdminOnly()
@Controller("system-admin/kaash")
export class SystemAdminController {
  constructor(private readonly service: KaashService) {}

  @Get("counts")
  counts() {
    return this.service.adminCounts();
  }

  @Post("query")
  @HttpCode(HttpStatus.OK)
  list(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Body() query: AdminKaashListQueryDto) {
    return this.service.adminList(admin, query);
  }

  @Get(":id/story")
  story(@Param("id", UuidParamPipe) id: string) {
    return this.service.adminStory(id);
  }

  @Get(":id")
  detail(@Param("id", UuidParamPipe) id: string) {
    return this.service.adminDetail(id);
  }

  @Patch(":id")
  update(@CurrentSystemAdmin() admin: AuthenticatedSystemAdmin, @Req() request: AppRequest, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateKaashDto) {
    return this.service.adminUpdate(admin, request, id, dto);
  }
}
