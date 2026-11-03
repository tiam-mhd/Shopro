import { Injectable } from "@nestjs/common";

type TelegramResponse = {
  ok?: boolean;
  error_code?: number;
  result?: { message_id?: number };
};

export type TelegramDeliveryResult = {
  status: "NOT_CONFIGURED" | "SENT" | "FAILED";
  messageId: string | null;
  errorCode: string | null;
};

@Injectable()
export class TelegramReceiptService {
  isConfigured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  }

  async sendReceipt(input: { targetChatId: string | null; bytes: Buffer; fileName: string; mimeType: string; caption: string }): Promise<TelegramDeliveryResult> {
    if (!this.isConfigured() || !input.targetChatId?.trim()) return { status: "NOT_CONFIGURED", messageId: null, errorCode: null };
    const form = new FormData();
    form.append("chat_id", input.targetChatId.trim());
    form.append("caption", input.caption.slice(0, 1000));
    form.append("document", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName);
    return this.call("sendDocument", form);
  }

  async sendTest(targetChatId: string | null) {
    if (!this.isConfigured()) return { sent: false, errorCode: "TELEGRAM_TOKEN_NOT_CONFIGURED" };
    if (!targetChatId?.trim()) return { sent: false, errorCode: "TELEGRAM_CHAT_ID_NOT_CONFIGURED" };
    const body = new URLSearchParams({ chat_id: targetChatId.trim(), text: "تنظیمات ارسال رسید اشتراک شاپرو آزمایش شد." });
    const result = await this.call("sendMessage", body);
    return { sent: result.status === "SENT", errorCode: result.errorCode };
  }

  private async call(method: "sendDocument" | "sendMessage", body: FormData | URLSearchParams): Promise<TelegramDeliveryResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return { status: "NOT_CONFIGURED", messageId: null, errorCode: null };
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => null) as TelegramResponse | null;
      if (!response.ok || !payload?.ok) {
        const code = typeof payload?.error_code === "number" ? payload.error_code : response.status;
        return { status: "FAILED", messageId: null, errorCode: `TELEGRAM_${code}` };
      }
      return { status: "SENT", messageId: payload.result?.message_id == null ? null : String(payload.result.message_id), errorCode: null };
    } catch {
      return { status: "FAILED", messageId: null, errorCode: "TELEGRAM_NETWORK_ERROR" };
    }
  }
}
