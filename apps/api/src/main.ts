import "dotenv/config";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { createMarketingHostMiddleware } from "./marketing-host.middleware.js";
import { validateProductionEnv, webOrigins } from "./common/production-env.js";
import type { AppRequest } from "./common/request-context.js";
import type { NextFunction, Response } from "express";

async function bootstrap() {
  validateProductionEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api/v1");
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) throw new Error("TRUST_PROXY_HOPS باید عددی بین صفر تا ده باشد.");
  app.getHttpAdapter().getInstance().set("trust proxy", trustProxyHops);
  app.use(helmet({ contentSecurityPolicy: { directives: { "img-src": ["'self'", "data:", "blob:"] } }, crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cookieParser());
  app.enableCors({ origin: webOrigins(), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Business-Id", "X-Branch-Id", "X-Attachment-Download-Token", "X-Storefront-Customer-Token", "Idempotency-Key"] });
  app.use((request: AppRequest, response: Response, next: NextFunction) => {
    const supplied = request.header("x-request-id");
    request.requestId = supplied && /^[\w.-]{1,80}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  if (process.env.MARKETING_PUBLIC_URL) {
    app.use(await createMarketingHostMiddleware({
      publicUrl: process.env.MARKETING_PUBLIC_URL,
      productUrl: process.env.PRODUCT_URL ?? "https://web.shoproapp.ir",
      allowedOrigins: webOrigins(),
      staticRoot: resolve(process.cwd(), "apps/marketing/dist"),
      httpsOnly: process.env.NODE_ENV === "production",
    }));
  }
  if (process.env.NODE_ENV === "production") {
    const webRoot = resolve(process.cwd(), "apps/web/dist");
    app.use(express.static(webRoot, { index: false }));
    app.use((request: AppRequest, response: Response, next: NextFunction) => {
      if (request.method !== "GET" || request.path === "/api" || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(resolve(webRoot, "index.html"));
    });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}

bootstrap();
