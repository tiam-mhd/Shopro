import { randomUUID } from "node:crypto";
import { parseBackupKey } from "./crypto-envelope.mjs";
import { lstat, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ATTACHMENTS_BACKUP_NAME,
  BACKUP_NAME_PATTERN,
  DATABASE_BACKUP_NAME,
  MANIFEST_NAME,
  artifactInfo,
  acquireAttachmentBackupLock,
  assertOutsidePublicRoots,
  createTempDirectory,
  ensureArtifactDirectory,
  isWithin,
  parseDatabaseUrl,
  readBackupManifest,
  removeOwnedTempDirectory,
  runEncryptedDump,
  runEncryptedTar,
  runQueryLines,
  deleteFile,
  querySingleValue,
  verifyAttachmentFile,
  writeManifest,
} from "./backup-common.mjs";

function retentionDaysFromEnvironment() {
  const value = process.env.BACKUP_RETENTION_DAYS;
  if (!/^[1-9]\d{0,4}$/.test(value ?? "")) throw new Error("BACKUP_RETENTION_DAYS must be set to an explicit positive number of days.");
  const days = Number(value);
  if (days > 36_500) throw new Error("BACKUP_RETENTION_DAYS cannot exceed 36500.");
  return days;
}

async function validateAttachmentRoot(path) {
  const root = resolve(path);
  assertOutsidePublicRoots(root, "ATTACHMENT_STORAGE_DIR");
  const info = await lstat(root).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error("ATTACHMENT_STORAGE_DIR must exist as a non-symlink directory.");
  return root;
}

async function createAttachmentList(env, root, stagePath) {
  const listPath = resolve(stagePath, ".attachment-files.list");
  const handle = await import("node:fs/promises").then(({ open }) => open(listPath, "wx", 0o600));
  let count = 0;
  const seen = new Set();
  try {
    await runQueryLines(env, "SELECT storage_key, bytes::text, checksum FROM attachments UNION ALL SELECT storage_key, bytes::text, checksum FROM subscription_manual_payment_submissions ORDER BY storage_key", async (line) => {
      const [storageKey, bytes, checksum, extra] = line.split("\t");
      if (!storageKey || bytes === undefined || checksum === undefined || extra !== undefined) throw new Error("PostgreSQL returned invalid attachment metadata; backup was stopped.");
      if (seen.has(storageKey)) throw new Error("Database contains duplicate attachment storage keys; backup was stopped.");
      seen.add(storageKey);
      await verifyAttachmentFile(root, { storageKey, bytes, checksum });
      await handle.write(`${storageKey}\0`);
      count += 1;
    });
  } finally {
    await handle.close();
  }
  return { count, listPath };
}

async function validateBackupDirectoryContents(path, manifest) {
  const allowed = new Set([MANIFEST_NAME, DATABASE_BACKUP_NAME]);
  if (manifest.attachments) allowed.add(ATTACHMENTS_BACKUP_NAME);
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !allowed.has(entry.name))) throw new Error("An existing backup directory has unexpected files and was retained.");
  if (entries.length !== allowed.size) throw new Error("An existing backup directory is incomplete and was retained.");
}

async function pruneExpiredBackups(root, days, preserveName) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === preserveName || !BACKUP_NAME_PATTERN.test(entry.name)) continue;
    const path = resolve(root, entry.name);
    try {
      const manifest = await readBackupManifest(path);
      const created = Date.parse(manifest.createdAt);
      if (!Number.isFinite(created) || created > Date.now() + 5 * 60 * 1000) throw new Error("Backup timestamp is invalid.");
      await validateBackupDirectoryContents(path, manifest);
      if (created < cutoff) {
        if (!isWithin(root, path) || path === root) throw new Error("Retention target escaped BACKUP_DIR.");
        await rm(path, { recursive: true, force: false });
        removed.push(entry.name);
      }
    } catch (error) {
      throw new Error(`Retention stopped at ${entry.name}: ${error.message}`);
    }
  }
  return removed;
}

async function main() {
  const database = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const retentionDays = retentionDaysFromEnvironment();
  const backupRoot = await ensureArtifactDirectory(process.env.BACKUP_DIR);
  const configuredAttachmentRoot = process.env.ATTACHMENT_STORAGE_DIR?.trim();
  const attachmentRoot = configuredAttachmentRoot ? await validateAttachmentRoot(configuredAttachmentRoot) : null;
  if (attachmentRoot && (isWithin(attachmentRoot, backupRoot) || isWithin(backupRoot, attachmentRoot))) {
    throw new Error("BACKUP_DIR and ATTACHMENT_STORAGE_DIR must be separate, non-overlapping directories.");
  }

  const timestamp = new Date().toISOString();
  const backupName = `shopro-backup-${timestamp.replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z")}-${randomUUID()}`;
  if (!BACKUP_NAME_PATTERN.test(backupName)) throw new Error("Generated backup name did not pass its safety check.");
  const destination = resolve(backupRoot, backupName);
  const stage = await createTempDirectory(backupRoot, ".shopro-backup-stage-");
  let releaseLock;
  try {
    releaseLock = await acquireAttachmentBackupLock(database.env);
    let attachmentCount = 0;
    let attachmentListPath;
    if (attachmentRoot) {
      const result = await createAttachmentList(database.env, attachmentRoot, stage);
      attachmentCount = result.count;
      attachmentListPath = result.listPath;
    } else {
      const count = await querySingleValue(database.env, "SELECT ((SELECT count(*) FROM attachments) + (SELECT count(*) FROM subscription_manual_payment_submissions))::text");
      if (!/^\d+$/.test(count)) throw new Error("PostgreSQL returned an invalid attachment count.");
      if (BigInt(count) > 0n) throw new Error("ATTACHMENT_STORAGE_DIR is required because the database contains receipt attachments.");
    }

    const databasePath = resolve(stage, DATABASE_BACKUP_NAME);
    await runEncryptedDump(key, databasePath, database.env);
    const databaseInfo = await artifactInfo(databasePath, DATABASE_BACKUP_NAME);
    let attachmentsInfo = null;
    if (attachmentCount > 0 && attachmentRoot && attachmentListPath) {
      const attachmentPath = resolve(stage, ATTACHMENTS_BACKUP_NAME);
      await runEncryptedTar(key, attachmentPath, database.env, attachmentRoot, attachmentListPath);
      attachmentsInfo = await artifactInfo(attachmentPath, ATTACHMENTS_BACKUP_NAME);
    }
    if (attachmentListPath) await deleteFile(attachmentListPath);

    const manifest = {
      formatVersion: 1,
      encryption: "AES-256-GCM",
      createdAt: timestamp,
      attachmentCount,
      database: databaseInfo,
      attachments: attachmentsInfo,
    };
    await writeManifest(resolve(stage, MANIFEST_NAME), manifest);
    await validateBackupDirectoryContents(stage, manifest);
    await import("node:fs/promises").then(({ rename }) => rename(stage, destination));
    await releaseLock();
    releaseLock = undefined;
    const removed = await pruneExpiredBackups(backupRoot, retentionDays, backupName);
    process.stdout.write(JSON.stringify({ event: "backup.completed", backup: destination, attachmentCount, pruned: removed.length }) + "\n");
  } finally {
    if (releaseLock) await releaseLock();
    await removeOwnedTempDirectory(stage, backupRoot, ".shopro-backup-stage-");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Backup failed."}\n`);
  process.exitCode = 1;
});
