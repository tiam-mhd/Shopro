import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import type { AppRequest } from "./request-context.js";

const messages: Record<number, string> = {
  400: "اطلاعات واردشده معتبر نیست.", 401: "برای ادامه وارد حساب کاربری شوید.", 403: "اجازهٔ انجام این کار را ندارید.",
  404: "مورد درخواستی پیدا نشد.", 409: "این تغییر با اطلاعات فعلی سازگار نیست.", 429: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<AppRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const detail = typeof body === "object" && body && "message" in body ? (body as { message: unknown }).message : undefined;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("؛ ") : messages[status] ?? "خطایی در پردازش درخواست رخ داد.";
    response.status(status).json({ code: status === 500 ? "INTERNAL_ERROR" : `HTTP_${status}`, message, requestId: request.requestId ?? null });
    if (status >= 500) process.stderr.write(JSON.stringify({ level: "error", requestId: request.requestId, path: request.path, status }) + "\n");
  }
}
