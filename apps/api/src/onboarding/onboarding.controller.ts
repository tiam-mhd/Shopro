import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { TrackOnboardingEventDto, UpdateOnboardingProgressDto } from "./onboarding.dto.js";
import { OnboardingService } from "./onboarding.service.js";

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) { return this.onboarding.get(user); }

  @Patch("progress")
  progress(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOnboardingProgressDto) { return this.onboarding.updateProgress(user, dto); }

  @Post("events")
  events(@CurrentUser() user: AuthenticatedUser, @Body() dto: TrackOnboardingEventDto) { return this.onboarding.trackEvent(user, dto); }
}
