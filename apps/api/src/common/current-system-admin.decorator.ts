import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { AppRequest } from "./request-context.js";

export const CurrentSystemAdmin = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AppRequest>();
  if (!request.systemAdmin) throw new UnauthorizedException("نشست مدیر سامانه معتبر نیست.");
  return request.systemAdmin;
});
