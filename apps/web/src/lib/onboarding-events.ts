import { post } from "./api.js";
import { deviceTypeFromUserAgent } from "./onboarding.js";

export type OnboardingEventName =
  | "onboarding_started"
  | "auth_completed"
  | "business_created"
  | "branch_created"
  | "financial_start_mode_selected"
  | "product_created"
  | "first_document_posted"
  | "dashboard_viewed_after_first_document"
  | "onboarding_step_skipped"
  | "onboarding_resumed"
  | "pwa_install_prompt_shown"
  | "pwa_install_prompt_accepted";

export type OnboardingStepName = "welcome" | "business" | "branch" | "subscription" | "financial_start" | "product" | "opening_balances" | "first_operation" | "result" | "team" | "pwa";

export function trackOnboardingEvent(eventName: OnboardingEventName, stepName?: OnboardingStepName) {
  const deviceType = deviceTypeFromUserAgent(navigator.userAgent);
  void post("/onboarding/events", { eventName, ...(stepName ? { stepName } : {}), deviceType }).catch(() => undefined);
}
