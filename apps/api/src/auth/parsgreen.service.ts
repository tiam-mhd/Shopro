import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";

export class SmsProviderUnavailable extends Error {}

@Injectable()
export class ParsgreenService {
  async sendOtp(phone: string, code: string): Promise<void> {
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
        body: JSON.stringify({
          Mobile: phone,
          SmsCode: code,
        }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== "object" || !("R_Success" in payload) || payload.R_Success !== true) {
        throw new Error("SMS_PROVIDER_REJECTED");
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof BadGatewayException) throw error;
      throw new BadGatewayException("ارسال کد انجام نشد؛ کمی بعد دوباره تلاش کنید.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
