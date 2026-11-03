import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createDecryptionStream, parseBackupKey } from "./crypto-envelope.mjs";
import {
  ATTACHMENTS_BACKUP_NAME,
  BACKUP_NAME_PATTERN,
  DATABASE_BACKUP_NAME,
  MANIFEST_NAME,
  assertOutsidePublicRoots,
  createTempDirectory,
  extractEncryptedTar,
  inspectEncryptedTar,
  isWithin,
  parseDatabaseUrl,
  requireAbsolutePath,
  readBackupManifest,
  removeOwnedTempDirectory,
  restoreAttachmentRowsToSet,
  validateEmptyRestoreDatabase,
  validateLoopbackRestoreUrl,
  verifyManifestArtifact,
  verifyRestoredAttachmentRows,
} from "./backup-common.mjs";

function recordStderr(child) {
  let value = "";
  child.stderr?.on("data", (chunk) => { if (value.length < 8192) value += chunk.toString("utf8").slice(0, 8192 - value.length); });
  return () => value;
}

function waitForChild(child, name, stderr) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", (error) => rejectPromise(new Error(`${name} could not start: ${error.message}`)));
    child.once("close", (code, signal) => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${name} failed (exit ${code ?? signal ?? "unknown"}). ${stderr().trim().slice(0, 1200)}`)));
  });
}

async function runDatabaseRestore(key, encryptedDump, database) {
  const command = process.env.PG_RESTORE_BIN || "pg_restore";
  const args = ["--no-password", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "--dbname", database.database];
  const child = spawn(command, args, { env: database.env, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  const stderr = recordStderr(child);
  const exited = waitForChild(child, "pg_restore", stderr);
  try {
    await Promise.all([pipeline(createReadStream(encryptedDump), createDecryptionStream(key), child.stdin), exited]);
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

async function validateBackupDirectory(path, manifest) {
  const expected = new Set([MANIFEST_NAME, DATABASE_BACKUP_NAME]);
  if (manifest.attachments) expected.add(ATTACHMENTS_BACKUP_NAME);
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length !== expected.size || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !expected.has(entry.name))) {
    throw new Error("Backup directory contains unexpected or missing entries.");
  }
}

async function prepareAttachmentDestination(value, backupPath) {
  const path = requireAbsolutePath(value, "RESTORE_ATTACHMENT_STORAGE_DIR");
  assertOutsidePublicRoots(path, "RESTORE_ATTACHMENT_STORAGE_DIR");
  if (isWithin(path, backupPath) || isWithin(backupPath, path)) throw new Error("Restore attachment directory and backup directory must be separate.");
  const existing = await lstat(path).catch(() => null);
  if (existing) throw new Error("RESTORE_ATTACHMENT_STORAGE_DIR must not exist; use a new empty directory.");
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("RESTORE_ATTACHMENT_STORAGE_DIR parent must be a non-symlink directory.");
  return path;
}

async function validateCoreSchema(env) {
  const { querySingleValue } = await import("./backup-common.mjs");
  const result = await querySingleValue(env, "SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('_prisma_migrations','businesses','branches','journal_entries','journal_lines','expenses','attachments')");
  if (result !== "7") throw new Error("Restored database is missing one or more required Shopro tables.");
  const migrations = await querySingleValue(env, "SELECT count(*)::text FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL");
  if (!/^\d+$/.test(migrations) || BigInt(migrations) < 1n) throw new Error("Restored database has no completed Prisma migration records.");
}

async function main() {
  const backupArgument = process.argv[2];
  if (!backupArgument || process.argv.length !== 3) throw new Error("Usage: node scripts/backup/restore.mjs <backup-directory>");
  const backupPath = resolve(backupArgument);
  const backupName = backupPath.split(/[\\/]/).at(-1) ?? "";
  if (!BACKUP_NAME_PATTERN.test(backupName)) throw new Error("Backup directory name is not recognized.");
  const manifest = await readBackupManifest(backupPath);
  await validateBackupDirectory(backupPath, manifest);
  const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const database = parseDatabaseUrl(process.env.RESTORE_DATABASE_URL, "RESTORE_DATABASE_URL");
  validateLoopbackRestoreUrl(database, process.env.RESTORE_CONFIRM_DATABASE);
  const databasePath = await verifyManifestArtifact(backupPath, manifest.database, DATABASE_BACKUP_NAME);
  const attachmentPath = manifest.attachments
    ? await verifyManifestArtifact(backupPath, manifest.attachments, ATTACHMENTS_BACKUP_NAME)
    : null;

  let destination;
  let attachmentStage;
  let attachmentStageParent;
  try {
    await validateEmptyRestoreDatabase(database.env);
    if (manifest.attachmentCount > 0) {
      const configured = process.env.RESTORE_ATTACHMENT_STORAGE_DIR?.trim();
      if (!configured) throw new Error("RESTORE_ATTACHMENT_STORAGE_DIR is required because this backup includes receipt attachments.");
      destination = await prepareAttachmentDestination(configured, backupPath);
      attachmentStageParent = dirname(destination);
      attachmentStage = await createTempDirectory(attachmentStageParent, ".shopro-restore-stage-");
      const names = await inspectEncryptedTar(key, attachmentPath, database.env);
      if (names.length !== manifest.attachmentCount) throw new Error("Attachment archive file count does not match its manifest.");
      await extractEncryptedTar(key, attachmentPath, database.env, attachmentStage);
    } else {
      const rows = await import("./backup-common.mjs").then(({ querySingleValue }) => querySingleValue(database.env, "SELECT 0::text"));
      if (rows !== "0") throw new Error("Could not initialize attachment restore verification.");
    }

    await runDatabaseRestore(key, databasePath, database);
    await validateCoreSchema(database.env);

    if (manifest.attachmentCount > 0) {
      const rows = await restoreAttachmentRowsToSet(database.env);
      await verifyRestoredAttachmentRows(attachmentStage, rows, manifest.attachmentCount);
      await rename(attachmentStage, destination);
      attachmentStage = undefined;
    } else {
      const { querySingleValue } = await import("./backup-common.mjs");
      const count = await querySingleValue(database.env, "SELECT count(*)::text FROM attachments");
      if (count !== "0") throw new Error("Restored database contains attachments but the backup has no attachment archive.");
    }
    process.stdout.write(JSON.stringify({ event: "restore.completed", backup: backupName, database: database.database, attachmentCount: manifest.attachmentCount, attachmentDirectory: destination ?? null }) + "\n");
  } finally {
    if (attachmentStage && attachmentStageParent) await removeOwnedTempDirectory(attachmentStage, attachmentStageParent, ".shopro-restore-stage-");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Restore failed."}\n`);
  process.exitCode = 1;
});
