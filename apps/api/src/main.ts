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
import type { AppRequest } from "./common/request-context.js";
import type { NextFunction, Response } from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api/v1");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(","), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Business-Id", "X-Branch-Id", "Idempotency-Key"] });
  app.use((request: AppRequest, response: Response, next: NextFunction) => {
    const supplied = request.header("x-request-id");
    request.requestId = supplied && /^[\w.-]{1,80}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
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
