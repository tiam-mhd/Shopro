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

@Module({
  imports: [PrismaModule, AuthModule, BusinessesModule, PartiesModule, ProductsModule, SalesModule, PurchasesModule, ExpensesModule, FinanceModule, ReportsModule, InventoryModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
