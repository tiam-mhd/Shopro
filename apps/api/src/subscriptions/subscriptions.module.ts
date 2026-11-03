import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller.js";
import { SubscriptionsService } from "./subscriptions.service.js";
import { SubscriptionAdminController } from "./subscription-admin.controller.js";
import { SubscriptionAdminService } from "./subscription-admin.service.js";
import { ManualPaymentsService } from "./manual-payments.service.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { TelegramReceiptService } from "./telegram-receipt.service.js";

@Module({ controllers: [SubscriptionsController, SubscriptionAdminController], providers: [SubscriptionsService, SubscriptionAdminService, ManualPaymentsService, AttachmentStorageService, TelegramReceiptService], exports: [SubscriptionsService, SubscriptionAdminService] })
export class SubscriptionsModule {}
