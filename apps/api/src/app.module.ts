import { APP_GUARD } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { SessionGuard } from "./common/session.guard.js";
import { CsrfGuard } from "./common/csrf.guard.js";
import { HealthController } from "./health.controller.js";
import { BusinessesModule } from "./businesses/businesses.module.js";
import { PartiesModule } from "./parties/parties.module.js";
import { ProductsModule } from "./products/products.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { PurchasesModule } from "./purchases/purchases.module.js";
import { ExpensesModule } from "./expenses/expenses.module.js";
import { FinanceModule } from "./finance/finance.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { SystemAdminModule } from "./system-admin/system-admin.module.js";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module.js";
import { SubscriptionEntitlementGuard } from "./subscriptions/subscription-entitlement.guard.js";
import { SyncModule } from "./sync/sync.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { StorefrontModule } from "./storefront/storefront.module.js";

@Module({
  imports: [PrismaModule, AuthModule, BusinessesModule, PartiesModule, ProductsModule, SalesModule, PurchasesModule, ExpensesModule, FinanceModule, ReportsModule, InventoryModule, SystemAdminModule, SubscriptionsModule, SyncModule, OnboardingModule, StorefrontModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SubscriptionEntitlementGuard },
  ],
})
export class AppModule {}
