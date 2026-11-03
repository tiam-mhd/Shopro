export type VerifiedPayment = {
  orderId: string;
  providerExternalId: string;
  amountRial: bigint;
  currency: string;
  confirmedAt: Date;
};

export interface PaymentGateway {
  readonly provider: string | null;
  readonly mode: "fake" | "unavailable";
  createCheckout(input: { orderId: string; amountRial: bigint; currency: string }): { providerReference: string };
  verifyCallback(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): Promise<VerifiedPayment>;
  refund(input: { providerReference: string; amountRial: bigint; currency: string }): Promise<void>;
}

export class FakePaymentGateway implements PaymentGateway {
  readonly provider = "fake";
  readonly mode = "fake" as const;

  createCheckout(input: { orderId: string }) {
    return { providerReference: `fake-${input.orderId}-${globalThis.crypto.randomUUID()}` };
  }

  async verifyCallback(): Promise<VerifiedPayment> {
    throw new Error("Fake payment callbacks are available only through the local/test confirmation route.");
  }

  async refund(): Promise<void> {
    throw new Error("Fake payment refunds are not exposed as production accounting events.");
  }
}

export class UnavailablePaymentGateway implements PaymentGateway {
  readonly provider = null;
  readonly mode = "unavailable" as const;

  createCheckout(): never {
    throw new Error("No production payment provider has been selected or configured.");
  }

  async verifyCallback(): Promise<never> {
    throw new Error("No production payment provider has been selected or configured.");
  }

  async refund(): Promise<never> {
    throw new Error("No production payment provider has been selected or configured.");
  }
}

export function paymentGateway(env: NodeJS.ProcessEnv = process.env): PaymentGateway {
  if (env.NODE_ENV !== "production" && (env.PAYMENT_GATEWAY ?? "fake") === "fake") return new FakePaymentGateway();
  return new UnavailablePaymentGateway();
}
