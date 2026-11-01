import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CurrentUser } from "../common/current-user.decorator.js";
import { CreateProductCategoryDto, CreateProductDto, UpdateProductDto } from "./products.dto.js";
import { ProductsService } from "./products.service.js";

@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query("q") q?: string, @Query("lowStock") low?: string) { return this.products.list(user, q, low); }
  @Get("units") units(@CurrentUser() user: AuthenticatedUser) { return this.products.units(user); }
  @Get("categories") categories(@CurrentUser() user: AuthenticatedUser) { return this.products.categories(user); }
  @Get(":id") get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.products.get(user, id); }
  @Post("categories") createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductCategoryDto, @Req() request: AppRequest) { return this.products.createCategory(user, dto, request); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto, @Req() request: AppRequest) { return this.products.create(user, dto, request); }
  @Patch(":id") update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateProductDto, @Req() request: AppRequest) { return this.products.update(user, id, dto, request); }
}
