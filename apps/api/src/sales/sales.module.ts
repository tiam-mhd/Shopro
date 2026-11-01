import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";
import { AccountingService } from "../finance/accounting.service.js";

@Module({ controllers: [SalesController], providers: [SalesService, AccountingService], exports: [SalesService] })
export class SalesModule {}
