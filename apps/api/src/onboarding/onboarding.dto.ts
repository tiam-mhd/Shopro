import { IsIn, IsOptional } from "class-validator";

export const ONBOARDING_STEP_IDS = ["financial_start_mode", "product", "first_operation", "team", "opening_balances"] as const;
export type OnboardingStepId = typeof ONBOARDING_STEP_IDS[number];

export class UpdateOnboardingProgressDto {
  @IsIn(["select_financial_start_mode", "skip_step", "resume_step", "mark_result_viewed"])
  action!: "select_financial_start_mode" | "skip_step" | "resume_step" | "mark_result_viewed";

  @IsOptional() @IsIn(["START_TODAY", "EXISTING_BUSINESS"])
  financialStartMode?: "START_TODAY" | "EXISTING_BUSINESS";

  @IsOptional() @IsIn(ONBOARDING_STEP_IDS)
  stepId?: OnboardingStepId;
}

export class TrackOnboardingEventDto {
  @IsIn([
    "onboarding_started", "auth_completed", "business_created", "branch_created",
    "financial_start_mode_selected", "product_created", "first_document_posted",
    "dashboard_viewed_after_first_document", "onboarding_step_skipped", "onboarding_resumed",
    "pwa_install_prompt_shown", "pwa_install_prompt_accepted",
  ])
  eventName!: string;

  @IsOptional() @IsIn(["welcome", "business", "branch", "subscription", "financial_start", "product", "opening_balances", "first_operation", "result", "team", "pwa"])
  stepName?: string;

  @IsIn(["MOBILE", "TABLET", "DESKTOP", "UNKNOWN"])
  deviceType!: "MOBILE" | "TABLET" | "DESKTOP" | "UNKNOWN";
}
