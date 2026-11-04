import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { OnboardingService } from "../dist/onboarding/onboarding.service.js";

function fixture({ role = "OWNER", sale = null, resultView = null, subscription = { status: "OBSERVE", rolloutMode: "OBSERVE", period: null } } = {}) {
  const state = { progress: null, resultView, events: [] };
  const user = { id: "user-a", businessId: "business-a", branchId: "branch-a", role };
  const prisma = {
    businessMember: {
      findFirst: async () => ({ role }),
      count: async () => 1,
    },
    business: { findUnique: async () => ({ id: "business-a", displayName: "کسب‌وکار نمونه", displayCurrency: "IRT", timezone: "Asia/Tehran" }) },
    branch: { findFirst: async () => ({ id: "branch-a", name: "شعبه اصلی", code: "MAIN" }) },
    onboardingProgress: {
      findUnique: async () => state.progress,
    },
    onboardingResultView: {
      findUnique: async ({ where }) => state.resultView?.userId === where.businessId_branchId_userId.userId ? state.resultView : null,
    },
    product: { count: async () => 0 },
    salesInvoice: { findFirst: async () => sale },
    purchase: { findFirst: async () => null },
    expense: { findFirst: async () => null },
    cashTransaction: { findFirst: async () => null },
    stockCount: { findFirst: async () => null },
    onboardingEvent: {
      findFirst: async () => null,
      create: async ({ data }) => { state.events.push(data); return data; },
    },
    $transaction: async (callback) => callback({
      onboardingProgress: {
        upsert: async ({ create, update }) => {
          state.progress = { ...create, ...state.progress, ...update };
          return state.progress;
        },
      },
      onboardingResultView: {
        upsert: async ({ create }) => {
          state.resultView ??= { ...create, viewedAt: new Date("2026-11-04T10:00:00.000Z") };
          return state.resultView;
        },
      },
    }),
  };
  const subscriptions = { current: async () => subscription };
  return { service: new OnboardingService(prisma, subscriptions), prisma, user, state };
}

test("onboarding recommends a first route that matches the member role and permissions", async () => {
  const cases = [
    ["OWNER", "/app/sales", "NEEDS_ACTION"],
    ["MANAGER", "/app/sales", "NEEDS_ACTION"],
    ["ACCOUNTANT", "/app/sales", "NEEDS_ACTION"],
    ["CASHIER", "/app/sales", "UNAVAILABLE"],
    ["VIEWER", "/app/invoices", "UNAVAILABLE"],
  ];
  for (const [role, href, productStatus] of cases) {
    const { service, user } = fixture({ role });
    const status = await service.get(user);
    assert.equal(status.nextAction.href, href, `${role} route`);
    assert.equal(status.role, role);
    assert.equal(status.steps.find(({ id }) => id === "product").status, productStatus, `${role} product permission`);
    assert.equal(status.activationComplete, false);
  }
});

test("skipped progress survives a later read and can be resumed", async () => {
  const { service, user, state } = fixture();
  const skipped = await service.updateProgress(user, { action: "skip_step", stepId: "product" });
  assert.deepEqual(state.progress.skippedSteps, ["product"]);
  assert.equal(skipped.steps.find(({ id }) => id === "product").status, "SKIPPED");

  const resumed = await service.updateProgress(user, { action: "resume_step", stepId: "product" });
  assert.deepEqual(state.progress.skippedSteps, []);
  assert.equal(resumed.steps.find(({ id }) => id === "product").status, "NEEDS_ACTION");
});

test("result viewing is stored as activation progress independently of analytics events", async () => {
  const sale = { id: "sale-a", invoiceNo: "S-1", createdAt: new Date("2026-11-04T08:00:00.000Z"), txnDate: new Date("2026-11-04T00:00:00.000Z") };
  const { service, user, state } = fixture({ sale });
  const status = await service.updateProgress(user, { action: "mark_result_viewed" });
  assert.equal(state.resultView.businessId, "business-a");
  assert.equal(state.resultView.branchId, "branch-a");
  assert.equal(state.resultView.userId, "user-a");
  assert.equal(status.activationComplete, true);
  assert.equal(status.resultViewedByCurrentUser, true);
  assert.equal(state.events.length, 0, "analytics being absent must not prevent activation completion");
});

test("a branch result view by another member does not complete this member's result step", async () => {
  const sale = { id: "sale-a", invoiceNo: "S-1", createdAt: new Date("2026-11-04T08:00:00.000Z"), txnDate: new Date("2026-11-04T00:00:00.000Z") };
  const { service, user } = fixture({ sale });
  await service.updateProgress(user, { action: "mark_result_viewed" });
  const anotherMember = { ...user, id: "user-b" };
  const status = await service.get(anotherMember);
  assert.equal(status.activationComplete, false);
  assert.equal(status.resultViewedByCurrentUser, false);
  assert.equal(status.steps.find(({ id }) => id === "result_viewed").status, "NEEDS_ACTION");
});

test("view-only members cannot change financial start mode", async () => {
  const { service, user } = fixture({ role: "VIEWER" });
  await assert.rejects(
    service.updateProgress(user, { action: "select_financial_start_mode", financialStartMode: "START_TODAY" }),
    (error) => error instanceof ForbiddenException,
  );
});

test("subscription step mirrors enforced branch entitlement without duplicating payment state", async () => {
  for (const status of ["REQUIRED", "EXPIRED", "SUSPENDED"]) {
    const { service, user } = fixture({ subscription: { status, rolloutMode: "ENFORCE", period: null } });
    const onboarding = await service.get(user);
    assert.equal(onboarding.steps.find(({ id }) => id === "subscription").status, "NEEDS_ACTION", `${status} must stop before the first write`);
    assert.equal(onboarding.subscription.status, status, "the server subscription status is returned unchanged");
  }
  const { service, user } = fixture({ subscription: { status: "GRACE", rolloutMode: "ENFORCE", period: null } });
  assert.equal((await service.get(user)).steps.find(({ id }) => id === "subscription").status, "DONE");
});

test("skip actions cannot mark required business or branch identity complete", async () => {
  const { service, user, state } = fixture();
  await assert.rejects(service.updateProgress(user, { action: "skip_step", stepId: "business_created" }), BadRequestException);
  assert.equal(state.progress, null);
});

test("analytics events persist only allowlisted, non-financial fields", async () => {
  const { service, user, state } = fixture();
  await service.trackEvent(user, {
    eventName: "onboarding_step_skipped",
    stepName: "product",
    deviceType: "MOBILE",
    amountRial: "999999",
    customerName: "private customer",
    token: "secret-token",
  });
  assert.deepEqual(Object.keys(state.events[0]).sort(), ["businessId", "branchId", "deviceType", "eventName", "role", "stepName", "userId"].sort());
  assert.equal("amountRial" in state.events[0], false);
  assert.equal("customerName" in state.events[0], false);
  assert.equal("token" in state.events[0], false);
});

test("first-operation analytics require a server-confirmed posted document", async () => {
  const { service, user } = fixture();
  await assert.rejects(
    service.trackEvent(user, { eventName: "first_document_posted", stepName: "first_operation", deviceType: "DESKTOP" }),
    BadRequestException,
  );
});
