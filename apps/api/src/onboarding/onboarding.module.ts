import { Module } from "@nestjs/common";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";
import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingService } from "./onboarding.service.js";

@Module({ imports: [SubscriptionsModule], controllers: [OnboardingController], providers: [OnboardingService] })
export class OnboardingModule {}
