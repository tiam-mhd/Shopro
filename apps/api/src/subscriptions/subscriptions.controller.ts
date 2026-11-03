import { Body, Controller, Get, Headers, Param, Post, Query, Req } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator.js";
import { Public } from "../common/public.decorator.js";
import { UuidParamPipe } from "../common/uuid-param.pipe.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { CreateSubscriptionOrderDto } from "./subscriptions.dto.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get("plans") plans() { return this.subscriptions.listPlans(); }
  @Get("current") current(@CurrentUser() user: AuthenticatedUser) { return this.subscriptions.current(user); }
  @Get("orders") orders(@CurrentUser() user: AuthenticatedUser, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.subscriptions.orders(user, cursor, limit); }
  @Get("orders/:id") order(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.subscriptions.order(user, id); }
  @Post("orders") createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSubscriptionOrderDto, @Headers("idempotency-key") key?: string) { return this.subscriptions.createOrder(user, dto, key); }
  @Post("orders/:id/dev-confirm") confirmFake(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) id: string) { return this.subscriptions.confirmFakeOrder(user, id); }

  @Public()
  @Post("webhook/:provider")
  webhook(@Param("provider") provider: string, @Req() _request: AppRequest) { return this.subscriptions.acceptProviderWebhook(provider); }
}
