import type { Prisma } from "../generated/prisma/client.js";

// Keep these keys in sync with scripts/backup/backup-common.mjs.
export const ATTACHMENT_BACKUP_LOCK_CLASS = 1_397_703_496;
export const ATTACHMENT_BACKUP_LOCK_OBJECT = 1_380_928_719;

export async function lockAttachmentMutationDuringBackup(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(${ATTACHMENT_BACKUP_LOCK_CLASS}, ${ATTACHMENT_BACKUP_LOCK_OBJECT})`;
}
