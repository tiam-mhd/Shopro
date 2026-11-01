import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { SystemAdminAuthController } from "./system-admin-auth.controller.js";
import { AuthService } from "./auth.service.js";
import { ParsgreenService } from "./parsgreen.service.js";

@Module({ controllers: [AuthController, SystemAdminAuthController], providers: [AuthService, ParsgreenService], exports: [AuthService] })
export class AuthModule {}
