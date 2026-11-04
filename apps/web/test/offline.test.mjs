import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyOfflineFailure,
  isQueueItemAwaitingServer,
  isQueueItemAutomaticallySyncable,
  isQueueItemManuallyRetryable,
} from "../src/lib/offline-state.js";

test("network, timeout, rate-limit and server errors require a manual retry", () => {
  for (const error of [new TypeError("offline"), { status: 408 }, { status: 425 }, { status: 429 }, { status: 503 }]) {
    assert.deepEqual(classifyOfflineFailure(error), { status: "failed", retryable: true, conflictType: null });
  }
  assert.deepEqual(classifyOfflineFailure({ status: 401 }), { status: "failed", retryable: true, conflictType: null });
});

test("validation, permission and duplicate conflicts are not retried automatically or repeatedly", () => {
  for (const status of [400, 403, 404, 409, 422]) {
    assert.deepEqual(classifyOfflineFailure({ status }), { status: "conflict", retryable: false, conflictType: "server" });
  }
});

test("only pending entries sync automatically and retry rules honor stored state and scope", () => {
  const pending = { status: "pending" };
  const retryable = { status: "failed", retryable: true };
  const blocked = { status: "failed", retryable: false };
  const serverConflict = { status: "conflict", conflictType: "server" };
  const scopeConflict = { status: "conflict", conflictType: "scope" };
  const succeeded = { status: "succeeded" };

  assert.equal(isQueueItemAwaitingServer(pending), true);
  assert.equal(isQueueItemAwaitingServer(succeeded), false);
  assert.equal(isQueueItemAutomaticallySyncable(pending), true);
  assert.equal(isQueueItemAutomaticallySyncable(retryable), false);
  assert.equal(isQueueItemAutomaticallySyncable(scopeConflict), false);
  assert.equal(isQueueItemManuallyRetryable(pending, true), true);
  assert.equal(isQueueItemManuallyRetryable(retryable, true), true);
  assert.equal(isQueueItemManuallyRetryable(blocked, true), false);
  assert.equal(isQueueItemManuallyRetryable(serverConflict, true), false);
  assert.equal(isQueueItemManuallyRetryable(scopeConflict, false), false);
  assert.equal(isQueueItemManuallyRetryable(scopeConflict, true), true);
  assert.equal(isQueueItemManuallyRetryable(succeeded, true), false);
});
