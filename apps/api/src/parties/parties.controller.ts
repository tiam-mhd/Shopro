import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { CreatePartyDto, UpdatePartyDto } from "./parties.dto.js";
import { PartiesService } from "./parties.service.js";

@Controller("parties")
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("type") type?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.parties.list(user, q, type, cursor, limit); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartyDto, @Req() request: AppRequest) { return this.parties.create(user, dto, request); }
  @Get(":id/statement") statement(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Query("through") through?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.parties.statement(user, id, through, cursor, limit ?? 100); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdatePartyDto, @Req() request: AppRequest) { return this.parties.update(user, id, dto, request); }
}
