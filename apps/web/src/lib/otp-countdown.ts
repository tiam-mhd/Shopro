import { useCallback, useEffect, useState } from "react";
import { faNumber } from "./format.js";

export type OtpTiming = { expiresAt: string; resendAt: string };

export function readOtpTiming(value: unknown): OtpTiming | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<OtpTiming>;
  if (typeof candidate.expiresAt !== "string" || typeof candidate.resendAt !== "string") return null;
  if (!Number.isFinite(Date.parse(candidate.expiresAt)) || !Number.isFinite(Date.parse(candidate.resendAt))) return null;
  return { expiresAt: candidate.expiresAt, resendAt: candidate.resendAt };
}

export function useOtpCountdown() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null || deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const startAt = useCallback((value: string | number) => {
    const timestamp = typeof value === "number" ? value : Date.parse(value);
    setNow(Date.now());
    setDeadline(Number.isFinite(timestamp) ? timestamp : null);
  }, []);
  const reset = useCallback(() => {
    setDeadline(null);
    setNow(Date.now());
  }, []);
  const remaining = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

  return { remaining, startAt, reset };
}

export function formatOtpCountdown(seconds: number) {
  const minutes = faNumber(Math.floor(seconds / 60)).padStart(2, "۰");
  const remainder = faNumber(seconds % 60).padStart(2, "۰");
  return minutes + ":" + remainder;
}

export function otpResendLabel(base: string, remaining: number | null) {
  return remaining !== null && remaining > 0 ? base + " · " + formatOtpCountdown(remaining) : base;
}

export function otpTimingFromError(error: unknown) {
  if (!error || typeof error !== "object" || !("details" in error)) return null;
  return readOtpTiming((error as { details?: unknown }).details);
}
