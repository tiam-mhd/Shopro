import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { MAX_PRODUCT_IMAGE_UPLOAD_BYTES } from "./product-image-files.js";
import { CreateProductCategoryDto, TransferCatalogItemDto } from "./products.dto.js";
import { CreateServiceDto, UpdateCatalogCategoryDto, UpdateServiceDto } from "./services.dto.js";
import { ServicesService } from "./services.service.js";

type UploadedServiceImage = { originalname: string; buffer: Buffer; size: number };

@Controller("services")
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get("categories") categories(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) { return this.services.categories(user, includeArchived === "true"); }
  @Post("categories") createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductCategoryDto, @Req() request: AppRequest) { return this.services.createCategory(user, dto, request); }
  @Patch("categories/:id") updateCategory(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateCatalogCategoryDto, @Req() request: AppRequest) { return this.services.updateCategory(user, id, dto, request); }
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") search?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.services.list(user, search, cursor, limit); }
  @Get(":id/images/:imageId") @Header("Content-Type", "image/webp") @Header("X-Content-Type-Options", "nosniff") @Header("Cache-Control", "private, max-age=300")
  async image(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("imageId", UuidParamPipe) imageId: string, @Res() response: Response) {
    const image = await this.services.readImage(user, id, imageId);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Content-Length", String(image.byteLength));
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, max-age=300");
    response.send(image);
  }
  @Post(":id/images") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PRODUCT_IMAGE_UPLOAD_BYTES, files: 1, fields: 1, parts: 2 }, preservePath: false }))
  uploadImage(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body("placement") placement: string | undefined, @UploadedFile() file: UploadedServiceImage | undefined, @Req() request: AppRequest) { return this.services.uploadImage(user, id, placement, file, request); }
  @Patch(":id/images/:imageId/primary") setPrimaryImage(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("imageId", UuidParamPipe) imageId: string, @Req() request: AppRequest) { return this.services.setPrimaryImage(user, id, imageId, request); }
  @Delete(":id/images/:imageId") deleteImage(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("imageId", UuidParamPipe) imageId: string, @Req() request: AppRequest) { return this.services.deleteImage(user, id, imageId, request); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.services.get(user, id); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceDto, @Req() request: AppRequest) { return this.services.create(user, dto, request); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateServiceDto, @Req() request: AppRequest) { return this.services.update(user, id, dto, request); }
  @Post(":id/transfer") transfer(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: TransferCatalogItemDto, @Req() request: AppRequest) { return this.services.transfer(user, id, dto.targetBranchId, request); }
}
