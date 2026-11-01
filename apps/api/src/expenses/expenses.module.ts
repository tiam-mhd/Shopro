import { Module } from "@nestjs/common";
import { ExpensesController } from "./expenses.controller.js";
import { ExpensesService } from "./expenses.service.js";
import { AccountingService } from "../finance/accounting.service.js";

@Module({ controllers: [ExpensesController], providers: [ExpensesService, AccountingService] })
export class ExpensesModule {}
