import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FinanceModule } from "../finance/finance.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { PublicStorefrontController, StorefrontController } from "./storefront.controller.js";
import { StorefrontService } from "./storefront.service.js";

@Module({
  imports: [AuthModule, FinanceModule, SalesModule],
  controllers: [PublicStorefrontController, StorefrontController],
  providers: [StorefrontService, AttachmentStorageService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
