import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import { CreateProductCategoryDto, CreateProductDto, UpdateProductDto, UpdateUnitsVisibilityDto } from "./products.dto.js";
import { ProductsService } from "./products.service.js";
import { MAX_PRODUCT_IMAGE_UPLOAD_BYTES } from "./product-image-files.js";
import { UpdateCatalogCategoryDto } from "./services.dto.js";

type UploadedProductImage = { originalname: string; buffer: Buffer; size: number };

@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("lowStock") low?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string, @Query("kind") kind?: string) { return this.products.list(user, q, low, cursor, limit, kind); }
  @Get("units") units(@CurrentUser() user: AuthenticatedUser) { return this.products.units(user); }
  @Get("units/settings") unitSettings(@CurrentUser() user: AuthenticatedUser) { return this.products.unitSettings(user); }
  @Patch("units/settings") updateUnitSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUnitsVisibilityDto, @Req() request: AppRequest) { return this.products.updateUnitSettings(user, dto, request); }
  @Get("categories") categories(@CurrentUser() user: AuthenticatedUser, @Query("includeArchived") includeArchived?: string) { return this.products.categories(user, includeArchived === "true"); }
  @Patch("categories/:id") updateCategory(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateCatalogCategoryDto, @Req() request: AppRequest) { return this.products.updateCategory(user, id, dto, request); }
  @Get(":id/images/:imageId") @Header("Content-Type", "image/webp") @Header("X-Content-Type-Options", "nosniff") @Header("Cache-Control", "private, max-age=300")
  async image(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("imageId", UuidParamPipe) imageId: string, @Res() response: Response) {
    const image = await this.products.readImage(user, id, imageId);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Content-Length", String(image.byteLength));
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, max-age=300");
    response.send(image);
  }
  @Post(":id/images") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PRODUCT_IMAGE_UPLOAD_BYTES, files: 1, fields: 1, parts: 2 }, preservePath: false }))
  uploadImage(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body("placement") placement: string | undefined, @UploadedFile() file: UploadedProductImage | undefined, @Req() request: AppRequest) { return this.products.uploadImage(user, id, placement, file, request); }
  @Patch(":id/images/:imageId/primary") setPrimaryImage(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("imageId", UuidParamPipe) imageId: string, @Req() request: AppRequest) { return this.products.setPrimaryImage(user, id, imageId, request); }
  @Delete(":id/images/:imageId") deleteImage(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("imageId", UuidParamPipe) imageId: string, @Req() request: AppRequest) { return this.products.deleteImage(user, id, imageId, request); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.products.get(user, id); }
  @Post("categories") createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductCategoryDto, @Req() request: AppRequest) { return this.products.createCategory(user, dto, request); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto, @Req() request: AppRequest) { return this.products.create(user, dto, request); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: UpdateProductDto, @Req() request: AppRequest) { return this.products.update(user, id, dto, request); }
}
