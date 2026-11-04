const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);

export function classifyOfflineFailure(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  if (status === null || RETRYABLE_STATUS_CODES.has(status) || status >= 500) {
    return { status: "failed", retryable: true, conflictType: null };
  }
  if (status === 401) {
    return { status: "failed", retryable: true, conflictType: null };
  }
  return { status: "conflict", retryable: false, conflictType: "server" };
}

export function isQueueItemAwaitingServer(item) {
  return item.status !== "succeeded";
}

export function isQueueItemAutomaticallySyncable(item) {
  return item.status === "pending";
}

export function isQueueItemManuallyRetryable(item, scopeMatches) {
  if (item.status === "pending") return true;
  if (item.status === "failed") return item.retryable === true;
  return item.status === "conflict" && item.conflictType === "scope" && scopeMatches;
}
