import { Body, Controller, Get, Patch, Post, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { AddMemberDto, CreateBranchDto, CreateBusinessDto, UpdateBusinessDto } from "./businesses.dto.js";
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
}
