import { Module } from "@nestjs/common";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";
import { AccountingService } from "../finance/accounting.service.js";
import { SalesOcrService } from "./sales-ocr.service.js";

@Module({ controllers: [SalesController], providers: [SalesService, SalesOcrService, AccountingService], exports: [SalesService] })
export class SalesModule {}
