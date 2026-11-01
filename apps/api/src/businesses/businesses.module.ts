import { Module } from "@nestjs/common";
import { BusinessesController } from "./businesses.controller.js";
import { BusinessesService } from "./businesses.service.js";

@Module({ controllers: [BusinessesController], providers: [BusinessesService], exports: [BusinessesService] })
export class BusinessesModule {}
