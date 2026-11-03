import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { AddMemberDto, CreateBranchDto, CreateBusinessDto, UpdateBusinessDto, UpdateMemberDto } from "./businesses.dto.js";
import { BusinessesService } from "./businesses.service.js";

@Controller("businesses")
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.businesses.list(user); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBusinessDto, @Req() request: AppRequest) { return this.businesses.create(user, dto, request); }
  @Get("current") current(@CurrentUser() user: AuthenticatedUser) { return this.businesses.current(user); }
  @Patch("current") update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBusinessDto, @Req() request: AppRequest) { return this.businesses.update(user, dto, request); }
  @Post("current/branches") branch(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBranchDto, @Req() request: AppRequest) { return this.businesses.createBranch(user, dto, request); }
  @Get("current/members") members(@CurrentUser() user: AuthenticatedUser) { return this.businesses.members(user); }
  @Post("current/members") addMember(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddMemberDto, @Req() request: AppRequest) { return this.businesses.addMember(user, dto, request); }
  @Patch("current/members/:id") updateMember(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateMemberDto, @Req() request: AppRequest) { return this.businesses.updateMember(user, id, dto, request); }
  @Get("current/members/:id/history") memberHistory(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.businesses.memberHistory(user, id); }
  @Get("current/audit") auditEvents(@CurrentUser() user: AuthenticatedUser, @Query("actorId") actorId?: string, @Query("action") action?: string, @Query("entityType") entityType?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.businesses.auditEvents(user, { actorId, action, entityType, from, to, cursor, limit }); }
}
