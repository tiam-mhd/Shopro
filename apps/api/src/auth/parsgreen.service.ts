import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

const logger = new Logger("ParsgreenService");
const successKeys = ["R_Success", "r_success", "Success", "success"] as const;

function isSuccessful(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return typeof value === "string" && ["true", "1"].includes(value.trim().toLowerCase());
}

function safeScalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.slice(0, 32);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

@Injectable()
export class ParsgreenService {
  async sendOtp(phone: string, code: string, requestId?: string): Promise<void> {
    const apiKey = process.env.PARSGREEN_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException("ارسال پیامک هنوز پیکربندی نشده است.");
    const baseUrl = (process.env.PARSGREEN_BASE_URL ?? "https://sms.parsgreen.ir").replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.PARSGREEN_TIMEOUT_MS ?? 10000));
    try {
      const response = await fetch(`${baseUrl}/Apiv2/Message/SendOtp`, {
        method: "POST",
        headers: {
          authorization: `BASIC APIKEY:${apiKey}`,
          "content-type": "application/json;charset=utf-8",
          accept: "application/json",
        },
        body: JSON.stringify({ Mobile: phone, SmsCode: code }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;
      const successKey = record ? successKeys.find((key) => Object.hasOwn(record, key)) : undefined;
      const successValue = successKey && record ? record[successKey] : undefined;

      if (response.ok && isSuccessful(successValue)) return;

      this.logFailure(requestId, {
        reason: !response.ok ? "provider_http_error" : successKey ? "provider_rejected_or_unknown_result" : "unrecognized_response",
        httpStatus: response.status,
        responseType: record ? "object" : payload === null ? "empty_or_non_json" : Array.isArray(payload) ? "array" : typeof payload,
        responseKeys: record ? Object.keys(record).slice(0, 12) : [],
        successKey: successKey ?? null,
        successValueType: successValue === null ? "null" : Array.isArray(successValue) ? "array" : typeof successValue,
        successValue: safeScalar(successValue),
      });
      throw new BadGatewayException("ارسال کد تأیید از سرویس پیامک تأیید نشد.");
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof BadGatewayException) throw error;
      this.logFailure(requestId, {
        reason: error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_network_error",
        errorType: error instanceof Error ? error.name : "unknown",
      });
      throw new BadGatewayException("پاسخ سرویس پیامک دریافت نشد؛ وضعیت ارسال کد ممکن است نامشخص باشد.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private logFailure(requestId: string | undefined, details: Record<string, unknown>): void {
    logger.error(JSON.stringify({ event: "parsgreen.otp.request_failed", requestId: requestId ?? null, ...details }));
  }
}
