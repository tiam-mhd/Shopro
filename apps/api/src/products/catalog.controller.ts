import { Controller, Get, Param, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { ServicesService } from "./services.service.js";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly services: ServicesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") search?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.services.catalog(user, search, cursor, limit); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.services.catalogItem(user, id); }
}
