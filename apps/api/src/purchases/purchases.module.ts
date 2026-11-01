import { Module } from "@nestjs/common";
import { PurchasesController } from "./purchases.controller.js";
import { PurchasesService } from "./purchases.service.js";
import { AccountingService } from "../finance/accounting.service.js";

@Module({ controllers: [PurchasesController], providers: [PurchasesService, AccountingService] })
export class PurchasesModule {}
