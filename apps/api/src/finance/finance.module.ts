import { Module } from "@nestjs/common";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";
import { AccountingService } from "./accounting.service.js";

@Module({ controllers: [FinanceController], providers: [FinanceService, AccountingService], exports: [FinanceService, AccountingService] })
export class FinanceModule {}
