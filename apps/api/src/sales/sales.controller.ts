import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { CreateSalesDto, CreateSalesReturnDto, PostSalesDto, VoidSalesDto } from "./sales.dto.js";
import { SalesService } from "./sales.service.js";
import { MAX_SALES_OCR_IMAGE_BYTES, SalesOcrService } from "./sales-ocr.service.js";

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService, private readonly ocr: SalesOcrService) {}
  @Get("ocr/availability") ocrAvailability(@CurrentUser() user: AuthenticatedUser) { return this.ocr.availability(user); }
  @Post("ocr") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SALES_OCR_IMAGE_BYTES, files: 1, fields: 0, parts: 1 }, preservePath: false }))
  ocrImage(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: { buffer: Buffer; size: number } | undefined, @Req() request: AppRequest) { return this.ocr.analyze(user, file, request); }
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.sales.list(user, q, status, cursor, limit); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalesDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.sales.createDraft(user, dto, key, request); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.sales.get(user, id); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateSalesDto, @Req() request: AppRequest) { return this.sales.updateDraft(user, id, dto, request); }
  @Post(":id/post") post(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: PostSalesDto, @Headers("idempotency-key") key?: string, @Req() request?: AppRequest) { return this.sales.post(user, id, dto, key, request); }
  @Post(":id/void") void(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: VoidSalesDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.sales.void(user, id, dto, key, request); }
  @Post(":id/returns") returnSale(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: CreateSalesReturnDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.sales.returnSale(user, id, dto, key, request); }
}
