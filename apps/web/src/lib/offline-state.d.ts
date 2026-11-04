export type OfflineQueueStatus = "pending" | "syncing" | "succeeded" | "failed" | "conflict";
export type OfflineConflictType = "scope" | "server" | null;

export function classifyOfflineFailure(error: unknown): {
  status: "failed" | "conflict";
  retryable: boolean;
  conflictType: OfflineConflictType;
};
export function isQueueItemAwaitingServer(item: { status: OfflineQueueStatus }): boolean;
export function isQueueItemAutomaticallySyncable(item: { status: OfflineQueueStatus }): boolean;
export function isQueueItemManuallyRetryable(
  item: { status: OfflineQueueStatus; retryable?: boolean; conflictType?: OfflineConflictType },
  scopeMatches: boolean,
): boolean;
