import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { KaashController } from "./kaash.controller.js";
import { SystemAdminController } from "./system-admin-kaash.controller.js";
import { KaashService } from "./kaash.service.js";

@Module({ imports: [PrismaModule], controllers: [KaashController, SystemAdminController], providers: [KaashService] })
export class KaashModule {}
