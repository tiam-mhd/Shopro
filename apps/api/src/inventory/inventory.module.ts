import { Module } from "@nestjs/common";
import { AccountingService } from "../finance/accounting.service.js";
import { InventoryController } from "./inventory.controller.js";
import { InventoryService } from "./inventory.service.js";

@Module({ controllers: [InventoryController], providers: [InventoryService, AccountingService] })
export class InventoryModule {}
