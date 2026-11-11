import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SystemAdminController } from "./system-admin.controller.js";
import { SystemAdminService } from "./system-admin.service.js";
import { AdminPanelService } from "./admin-panel.service.js";

@Module({ imports: [AuthModule], controllers: [SystemAdminController], providers: [SystemAdminService, AdminPanelService] })
export class SystemAdminModule {}
