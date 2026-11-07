import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";
import { ProductsService } from "./products.service.js";
import { AccountingService } from "../finance/accounting.service.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { ServicesController } from "./services.controller.js";
import { ServicesService } from "./services.service.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogSpreadsheetService } from "./catalog-spreadsheet.service.js";

@Module({ controllers: [ProductsController, ServicesController, CatalogController], providers: [ProductsService, ServicesService, CatalogSpreadsheetService, AccountingService, AttachmentStorageService], exports: [ProductsService, ServicesService] })
export class ProductsModule {}
