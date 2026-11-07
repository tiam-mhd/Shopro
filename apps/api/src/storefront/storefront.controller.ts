import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUser } from "../common/current-user.decorator.js";
import { Public } from "../common/public.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { MAX_ATTACHMENT_BYTES } from "../expenses/attachment-files.js";
import { CreateStorePaymentCardDto, CreateStorefrontOrderDto, CreateStorefrontReceiptDto, RejectStorefrontOrderDto, RejectStorefrontPaymentDto, ResolveStorefrontOverpaymentDto, SetStorePaymentCardActiveDto, StorefrontListingDto, StorefrontOtpDto, StorefrontSettingsDto, TransitionStorefrontOrderDto, UpdateStorefrontCustomerProfileDto, VerifyStorefrontOtpDto, VerifyStorefrontPaymentDto } from "./storefront.dto.js";
import { StorefrontService } from "./storefront.service.js";

type UploadedReceipt = { originalname: string; buffer: Buffer; size: number };

@Controller("public")
export class PublicStorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Public() @Post("stores/:slug/customer/otp/request") @HttpCode(HttpStatus.OK) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  requestCustomerOtp(@Param("slug") slug: string, @Body() dto: StorefrontOtpDto, @Req() request: AppRequest) { return this.storefront.requestCustomerOtp(slug, dto.phone, request); }

  @Public() @Post("stores/:slug/customer/otp/verify") @HttpCode(HttpStatus.OK) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  verifyCustomerOtp(@Param("slug") slug: string, @Body() dto: VerifyStorefrontOtpDto, @Req() request: AppRequest) { return this.storefront.verifyCustomerOtp(slug, dto.phone, dto.code, request.ip); }

  @Public() @Get("stores/:slug/customer") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  customerAccount(@Param("slug") slug: string, @Headers("x-storefront-customer-token") token: string | undefined, @Req() request: AppRequest) { return this.storefront.customerAccount(slug, token, request.ip); }

  @Public() @Patch("stores/:slug/customer/profile") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  updateCustomerProfile(@Param("slug") slug: string, @Headers("x-storefront-customer-token") token: string | undefined, @Body() dto: UpdateStorefrontCustomerProfileDto, @Req() request: AppRequest) { return this.storefront.updateCustomerProfile(slug, token, dto, request.ip); }

  @Public() @Post("stores/:slug/customer/checkout-token") @HttpCode(HttpStatus.OK) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  issueCustomerCheckoutToken(@Param("slug") slug: string, @Headers("x-storefront-customer-token") token: string | undefined, @Req() request: AppRequest) { return this.storefront.issueCustomerCheckoutToken(slug, token, request.ip); }

  @Public() @Get("stores/:slug/customer/orders") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  customerOrders(@Param("slug") slug: string, @Headers("x-storefront-customer-token") token: string | undefined, @Query("cursor") cursor: string | undefined, @Query("limit") limit: string | undefined, @Req() request: AppRequest) { return this.storefront.customerOrders(slug, token, cursor, limit, request.ip); }

  @Public() @Post("stores/:slug/customer/logout") @HttpCode(HttpStatus.NO_CONTENT) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  logoutCustomer(@Headers("x-storefront-customer-token") token: string | undefined, @Req() request: AppRequest) { return this.storefront.logoutCustomer(token, request.ip); }

  @Public() @Get("stores/:slug") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  getStore(@Param("slug") slug: string, @Req() request: AppRequest) { return this.storefront.publicStore(slug, request.ip); }

  @Public() @Get("stores/:slug/products") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  products(@Param("slug") slug: string, @Query("q") q: string | undefined, @Query("limit") limit: string | undefined, @Query("cursor") cursor: string | undefined, @Req() request: AppRequest) { return this.storefront.publicProducts(slug, q, limit, cursor, request.ip); }

  @Public() @Get("stores/:slug/products/:productId/images/:imageId") @Header("Content-Type", "image/webp") @Header("Cache-Control", "public, max-age=3600, immutable") @Header("X-Content-Type-Options", "nosniff") @Header("Cross-Origin-Resource-Policy", "cross-origin")
  async productImage(@Param("slug") slug: string, @Param("productId", UuidParamPipe) productId: string, @Param("imageId", UuidParamPipe) imageId: string, @Req() request: AppRequest, @Res() response: Response) {
    const image = await this.storefront.publicProductImage(slug, productId, imageId, request.ip);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Content-Length", String(image.byteLength));
    response.setHeader("Cache-Control", "public, max-age=3600, immutable");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.send(image);
  }

  @Public() @Get("stores/:slug/services/:serviceId/images/:imageId") @Header("Content-Type", "image/webp") @Header("Cache-Control", "public, max-age=3600, immutable") @Header("X-Content-Type-Options", "nosniff") @Header("Cross-Origin-Resource-Policy", "cross-origin")
  async serviceImage(@Param("slug") slug: string, @Param("serviceId", UuidParamPipe) serviceId: string, @Param("imageId", UuidParamPipe) imageId: string, @Req() request: AppRequest, @Res() response: Response) {
    const image = await this.storefront.publicServiceImage(slug, serviceId, imageId, request.ip);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Content-Length", String(image.byteLength));
    response.setHeader("Cache-Control", "public, max-age=3600, immutable");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.send(image);
  }

  @Public() @Post("stores/:slug/otp/request") @HttpCode(HttpStatus.OK) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  requestOtp(@Param("slug") slug: string, @Body() dto: StorefrontOtpDto, @Req() request: AppRequest) { return this.storefront.requestCheckoutOtp(slug, dto.phone, request); }

  @Public() @Post("stores/:slug/otp/verify") @HttpCode(HttpStatus.OK) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  verifyOtp(@Param("slug") slug: string, @Body() dto: VerifyStorefrontOtpDto, @Req() request: AppRequest) { return this.storefront.verifyCheckoutOtp(slug, dto.phone, dto.code, request.ip); }

  @Public() @Post("stores/:slug/orders") @HttpCode(HttpStatus.CREATED) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  createOrder(@Param("slug") slug: string, @Body() dto: CreateStorefrontOrderDto, @Headers("idempotency-key") key: string | undefined, @Req() request: AppRequest) { return this.storefront.createOrder(slug, dto, key, request); }

  @Public() @Get("orders/:token") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  customerOrder(@Param("token") token: string, @Req() request: AppRequest) { return this.storefront.customerOrder(token, request.ip); }

  @Public() @Post("orders/:token/receipts")
  @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 8, parts: 9 }, preservePath: false }))
  submitReceipt(@Param("token") token: string, @Body() dto: CreateStorefrontReceiptDto, @UploadedFile() file: UploadedReceipt | undefined, @Req() request: AppRequest) { return this.storefront.submitReceipt(token, dto, file, request.ip); }

  @Public() @Post("orders/:token/cancel") @HttpCode(HttpStatus.OK) @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  cancelOrder(@Param("token") token: string, @Req() request: AppRequest) { return this.storefront.cancelByCustomer(token, request.ip); }
}

@Controller("storefront")
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get() settings(@CurrentUser() user: AuthenticatedUser) { return this.storefront.settings(user); }
  @Patch() updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: StorefrontSettingsDto, @Req() request: AppRequest) { return this.storefront.updateSettings(user, dto, request); }

  @Get("listings") listings(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string, @Query("limit") limit?: string, @Query("categoryId") categoryId?: string, @Query("q") q?: string, @Query("productId") productId?: string) { return this.storefront.listings(user, page, limit, categoryId, q, productId); }
  @Patch("listings/:productId") updateListing(@CurrentUser() user: AuthenticatedUser, @Param("productId", UuidParamPipe) productId: string, @Body() dto: StorefrontListingDto, @Req() request: AppRequest) { return this.storefront.updateListing(user, productId, dto, request); }

  @Get("cards") cards(@CurrentUser() user: AuthenticatedUser) { return this.storefront.cards(user); }
  @Post("cards") createCard(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStorePaymentCardDto, @Req() request: AppRequest) { return this.storefront.createCard(user, dto, request); }
  @Patch("cards/:id") updateCard(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: SetStorePaymentCardActiveDto, @Req() request: AppRequest) { return this.storefront.updateCard(user, id, dto, request); }

  @Get("orders") @Header("Cache-Control", "private, no-store") orders(@CurrentUser() user: AuthenticatedUser, @Query("status") status?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.storefront.orders(user, status, cursor, limit); }
  @Get("orders/:id") @Header("Cache-Control", "private, no-store") order(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.storefront.orderDetail(user, id); }
  @Get("orders/:id/receipts/:attemptId") async receipt(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("attemptId", UuidParamPipe) attemptId: string, @Res() response: Response) {
    const file = await this.storefront.downloadReceipt(user, id, attemptId);
    response.set({ "Content-Type": file.mimeType, "Content-Length": String(file.bytes.byteLength), "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    response.status(200).send(file.bytes);
  }
  @Post("orders/:id/accept") accept(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Req() request: AppRequest) { return this.storefront.acceptOrder(user, id, request); }
  @Post("orders/:id/reject") reject(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: RejectStorefrontOrderDto, @Req() request: AppRequest) { return this.storefront.rejectOrder(user, id, dto, request); }
  @Post("orders/:id/payments/:attemptId/verify") verifyPayment(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("attemptId", UuidParamPipe) attemptId: string, @Body() dto: VerifyStorefrontPaymentDto, @Req() request: AppRequest) { return this.storefront.verifyPayment(user, id, attemptId, dto, request); }
  @Post("orders/:id/payments/:attemptId/resolve-overpayment") resolveOverpayment(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("attemptId", UuidParamPipe) attemptId: string, @Body() dto: ResolveStorefrontOverpaymentDto, @Req() request: AppRequest) { return this.storefront.resolveOverpayment(user, id, attemptId, dto, request); }
  @Post("orders/:id/payments/:attemptId/reject") rejectPayment(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Param("attemptId", UuidParamPipe) attemptId: string, @Body() dto: RejectStorefrontPaymentDto, @Req() request: AppRequest) { return this.storefront.rejectPayment(user, id, attemptId, dto, request); }
  @Post("orders/:id/transition") transition(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string, @Body() dto: TransitionStorefrontOrderDto, @Req() request: AppRequest) { return this.storefront.transitionOrder(user, id, dto, request); }
  @Get("analytics") analytics(@CurrentUser() user: AuthenticatedUser, @Query("days") days?: string) { return this.storefront.analytics(user, days); }
}
