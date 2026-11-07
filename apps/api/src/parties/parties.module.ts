import { Module } from "@nestjs/common";
import { CustomersController, PartiesController, SuppliersController } from "./parties.controller.js";
import { PartiesService } from "./parties.service.js";

@Module({ controllers: [PartiesController, CustomersController, SuppliersController], providers: [PartiesService], exports: [PartiesService] })
export class PartiesModule {}
