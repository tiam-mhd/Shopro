import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/public.decorator.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public() @Get("live")
  live() { return { status: "ok" }; }

  @Public() @Get("ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ready", database: "connected" };
  }
}
