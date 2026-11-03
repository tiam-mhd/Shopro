import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller.js";
import { SubscriptionsService } from "./subscriptions.service.js";
import { SubscriptionAdminController } from "./subscription-admin.controller.js";
import { SubscriptionAdminService } from "./subscription-admin.service.js";

@Module({ controllers: [SubscriptionsController, SubscriptionAdminController], providers: [SubscriptionsService, SubscriptionAdminService], exports: [SubscriptionsService, SubscriptionAdminService] })
export class SubscriptionsModule {}
