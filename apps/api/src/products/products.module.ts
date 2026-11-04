import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";
import { AccountingService } from "../finance/accounting.service.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";

@Module({ controllers: [ProductsController], providers: [ProductsService, AccountingService, AttachmentStorageService], exports: [ProductsService] })
export class ProductsModule {}
