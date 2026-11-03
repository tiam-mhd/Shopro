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
    const multerCode = exception && typeof exception === "object" && "code" in exception ? (exception as { code?: unknown }).code : undefined;
    const multerError = exception && typeof exception === "object" && (exception as { name?: unknown }).name === "MulterError";
    const status = exception instanceof HttpException ? exception.getStatus() : multerError && multerCode === "LIMIT_FILE_SIZE" ? HttpStatus.PAYLOAD_TOO_LARGE : multerError && typeof multerCode === "string" && multerCode.startsWith("LIMIT_") ? HttpStatus.BAD_REQUEST : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const detail = typeof body === "object" && body && "message" in body ? (body as { message: unknown }).message : undefined;
    const declaredCode = typeof body === "object" && body && "code" in body ? (body as { code: unknown }).code : undefined;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("؛ ") : status === HttpStatus.PAYLOAD_TOO_LARGE ? "حجم فایل پیوست نباید بیشتر از ۱۰ مگابایت باشد." : multerError && status === HttpStatus.BAD_REQUEST ? "ساختار فایل پیوست معتبر نیست." : messages[status] ?? "خطایی در پردازش درخواست رخ داد.";
    const stableCode = typeof declaredCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(declaredCode) ? declaredCode : undefined;
    response.status(status).json({ code: status === 500 ? "INTERNAL_ERROR" : stableCode ?? `HTTP_${status}`, message, requestId: request.requestId ?? null });
    if (status >= 500) process.stderr.write(JSON.stringify({ level: "error", requestId: request.requestId, path: request.path, method: request.method, status, error: safeErrorChain(exception) }) + "\n");
  }
}

function safeErrorChain(value: unknown) {
  // Keep diagnostics actionable without logging exception text, SQL, or submitted values.
  const chain: Array<Record<string, string | string[]>> = [];
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length && chain.length < 5) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const error = current as { name?: unknown; code?: unknown; errorCode?: unknown; meta?: unknown; cause?: unknown };
    const entry: Record<string, string | string[]> = {};
    if (typeof error.name === "string") entry.name = error.name.slice(0, 80);
    const code = safeCode(error.code);
    const errorCode = safeCode(error.errorCode);
    if (code) entry.code = code;
    if (errorCode && errorCode !== code) entry.errorCode = errorCode;
    if (error.meta && typeof error.meta === "object") {
      const meta = error.meta as Record<string, unknown>;
      const modelName = safeIdentifier(meta.modelName);
      const column = safeIdentifier(meta.column);
      const fieldName = safeIdentifier(meta.field_name);
      const constraint = safeIdentifier(meta.constraint);
      const table = safeIdentifier(meta.table);
      const target = Array.isArray(meta.target) ? meta.target.map(safeIdentifier).filter((part): part is string => !!part).slice(0, 8) : [];
      if (modelName) entry.model = modelName;
      if (column) entry.column = column;
      if (fieldName) entry.field = fieldName;
      if (constraint) entry.constraint = constraint;
      if (table) entry.table = table;
      if (target.length) entry.target = target;
      for (const key of ["driverAdapterError", "cause", "originalError"]) if (meta[key] && typeof meta[key] === "object") pending.push(meta[key]);
    }
    if (Object.keys(entry).length) chain.push(entry);
    if (error.cause && typeof error.cause === "object") pending.push(error.cause);
  }
  return chain;
}

function safeCode(value: unknown) {
  return typeof value === "string" && /^(?:P\d{4}|[A-Z0-9_]{2,32})$/.test(value) ? value : undefined;
}

function safeIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.$:" -]{1,120}$/.test(value) ? value : undefined;
}
