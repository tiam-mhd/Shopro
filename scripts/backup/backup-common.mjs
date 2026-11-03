import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createEncryptionStream, createDecryptionStream } from "./crypto-envelope.mjs";

export const ATTACHMENT_LOCK_CLASS = 1_397_703_496;
export const ATTACHMENT_LOCK_OBJECT = 1_380_928_719;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|png|webp)$/i;
export const BACKUP_NAME_PATTERN = /^shopro-backup-\d{8}T\d{9}Z-[0-9a-f-]{36}$/i;
export const MANIFEST_NAME = "manifest.json";
export const DATABASE_BACKUP_NAME = "database.dump.enc";
export const ATTACHMENTS_BACKUP_NAME = "attachments.tar.gz.enc";

export function parseDatabaseUrl(value, label = "DATABASE_URL") {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} is not a valid PostgreSQL URL.`); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error(`${label} must use postgres:// or postgresql://.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const username = decodeURIComponent(url.username);
  if (!host || !database || !username) throw new Error(`${label} must include a host, database, and user.`);
  const env = safeChildEnvironment();
  env.PGHOST = host;
  env.PGDATABASE = database;
  env.PGUSER = username;
  if (url.port) env.PGPORT = String(Number(url.port));
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGAPPNAME = "shopro-backup-tool";
  env.PGCONNECT_TIMEOUT = "15";
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) {
    if (!["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) throw new Error(`${label} contains an unsupported sslmode.`);
    env.PGSSLMODE = sslmode;
  }
  for (const [parameter, variable] of [["sslrootcert", "PGSSLROOTCERT"], ["sslcert", "PGSSLCERT"], ["sslkey", "PGSSLKEY"]]) {
    const path = url.searchParams.get(parameter);
    if (path) env[variable] = path;
  }
  return { host, database, username, env };
}

function safeChildEnvironment() {
  const env = {};
  for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "TEMP", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  if (!env.PATH && env.Path) env.PATH = env.Path;
  return env;
}

export function isWithin(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return resolve(value);
}

export function assertOutsidePublicRoots(path, label) {
  const target = resolve(path);
  const publicRoots = [resolve(process.cwd(), "apps/web/public"), resolve(process.cwd(), "apps/web/dist")];
  if (publicRoots.some((root) => isWithin(root, target))) throw new Error(`${label} must be outside apps/web/public and apps/web/dist.`);
}

export async function ensurePrivateDirectory(path, { create = false, label = "Directory" } = {}) {
  const absolute = requireAbsolutePath(path, label);
  if (create) await mkdir(absolute, { recursive: true, mode: 0o700 });
  const info = await lstat(absolute).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must exist as a non-symlink directory.`);
  await import("node:fs/promises").then(({ chmod }) => chmod(absolute, 0o700).catch(() => undefined));
  return absolute;
}

export async function ensureNewFile(path, mode = 0o600) {
  const handle = await open(path, "wx", mode);
  await handle.close();
}

export async function writePrivateFile(path, bytes) {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function verifyAttachmentFile(root, row) {
  if (!STORAGE_KEY_PATTERN.test(row.storageKey)) throw new Error("Database contains an invalid attachment storage key; backup was stopped.");
  if (!/^\d+$/.test(row.bytes) || BigInt(row.bytes) < 1n || BigInt(row.bytes) > BigInt(MAX_ATTACHMENT_BYTES)) throw new Error("Database contains an invalid attachment size; backup was stopped.");
  if (!/^[a-f0-9]{64}$/i.test(row.checksum)) throw new Error("Database contains an invalid attachment checksum; backup was stopped.");
  const path = resolve(root, row.storageKey);
  if (!isWithin(root, path) || path === root) throw new Error("Attachment path escaped its storage root.");
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size !== Number(row.bytes)) throw new Error(`Attachment ${row.storageKey} is missing or has an invalid size; backup was stopped.`);
  const actual = await sha256File(path);
  if (actual.sha256.toLowerCase() !== row.checksum.toLowerCase()) throw new Error(`Attachment ${row.storageKey} failed its checksum; backup was stopped.`);
  return path;
}

function startChild(command, args, env, { stdin = "ignore", stdout = "pipe" } = {}) {
  return spawn(command, args, { env, stdio: [stdin, stdout, "pipe"], windowsHide: true });
}

function captureStderr(child, maxBytes = 8192) {
  let text = "";
  child.stderr?.on("data", (chunk) => {
    if (text.length < maxBytes) text += chunk.toString("utf8").slice(0, maxBytes - text.length);
  });
  return () => text;
}

function childExit(child, toolName, getStderr) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", (error) => rejectPromise(new Error(`${toolName} could not start: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${toolName} failed (exit ${code ?? signal ?? "unknown"}). ${getStderr().trim().slice(0, 1200)}`));
    });
  });
}

export async function runQueryLines(env, query, onLine = () => undefined) {
  const command = process.env.PSQL_BIN || "psql";
  const child = startChild(command, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "\t", "-c", query], env);
  const getStderr = captureStderr(child);
  const exited = childExit(child, "psql", getStderr);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) await onLine(line);
    await exited;
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

export async function querySingleValue(env, query) {
  const rows = [];
  await runQueryLines(env, query, (line) => rows.push(line));
  if (rows.length !== 1) throw new Error("PostgreSQL returned an unexpected result while verifying backup state.");
  return rows[0];
}

export async function acquireAttachmentBackupLock(env) {
  const command = process.env.PSQL_BIN || "psql";
  const child = startChild(command, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-qAt"], env, { stdin: "pipe" });
  const getStderr = captureStderr(child);
  const exited = childExit(child, "psql advisory-lock session", getStderr);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const acquired = new Promise((resolvePromise, rejectPromise) => {
    lines.on("line", (line) => {
      if (line === "SHOPRO_BACKUP_LOCK_ACQUIRED") resolvePromise();
    });
    exited.catch((error) => rejectPromise(error));
  });
  child.stdin.write(`SELECT pg_advisory_lock(${ATTACHMENT_LOCK_CLASS}, ${ATTACHMENT_LOCK_OBJECT});\nSELECT 'SHOPRO_BACKUP_LOCK_ACQUIRED';\n`);
  try {
    await acquired;
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    lines.close();
    throw error;
  }
  return async () => {
    if (child.exitCode !== null) throw new Error("PostgreSQL backup lock session ended before backup completed.");
    child.stdin.end(`SELECT pg_advisory_unlock(${ATTACHMENT_LOCK_CLASS}, ${ATTACHMENT_LOCK_OBJECT});\n\\q\n`);
    await exited;
    lines.close();
  };
}

export async function runEncryptedDump(key, outputPath, env) {
  const command = process.env.PG_DUMP_BIN || "pg_dump";
  const args = ["--no-password", "--format=custom", "--compress=6", "--no-owner", "--no-acl"];
  const child = startChild(command, args, env);
  const getStderr = captureStderr(child);
  const exited = childExit(child, "pg_dump", getStderr);
  try {
    await Promise.all([
      pipeline(child.stdout, createEncryptionStream(key), await import("node:fs").then(({ createWriteStream }) => createWriteStream(outputPath, { flags: "wx", mode: 0o600 }))),
      exited,
    ]);
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

export async function runEncryptedTar(key, outputPath, env, attachmentRoot, namesListPath) {
  const command = process.env.TAR_BIN || "tar";
  const child = startChild(command, ["-czf", "-", "-C", attachmentRoot, "--null", "--files-from", "-"], env, { stdin: "pipe" });
  const getStderr = captureStderr(child);
  const exited = childExit(child, "tar", getStderr);
  try {
    await Promise.all([
      pipeline(child.stdout, createEncryptionStream(key), await import("node:fs").then(({ createWriteStream }) => createWriteStream(outputPath, { flags: "wx", mode: 0o600 }))),
      pipeline(createReadStream(namesListPath), child.stdin),
      exited,
    ]);
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

export async function runDecryptedArchive(key, encryptedPath, command, args, env, toolName) {
  const child = startChild(command, args, env, { stdin: "pipe", stdout: "pipe" });
  const getStderr = captureStderr(child);
  const exited = childExit(child, toolName, getStderr);
  try {
    await Promise.all([pipeline(createReadStream(encryptedPath), createDecryptionStream(key), child.stdin), exited]);
    return child.stdout;
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

export async function inspectEncryptedTar(key, encryptedPath, env) {
  const command = process.env.TAR_BIN || "tar";
  const child = startChild(command, ["-tzvf", "-"], env, { stdin: "pipe" });
  const getStderr = captureStderr(child);
  const exited = childExit(child, "tar archive inspection", getStderr);
  const names = [];
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    await Promise.all([
      pipeline(createReadStream(encryptedPath), createDecryptionStream(key), child.stdin),
      (async () => {
        for await (const line of lines) {
          const type = line[0];
          const name = line.trim().split(/\s+/).at(-1) ?? "";
          if (type !== "-" || !STORAGE_KEY_PATTERN.test(name)) throw new Error("Attachment archive contains an unexpected path or non-file entry.");
          names.push(name);
        }
      })(),
      exited,
    ]);
    if (new Set(names).size !== names.length) throw new Error("Attachment archive contains duplicate paths.");
    return names;
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

export async function extractEncryptedTar(key, encryptedPath, env, destination) {
  const command = process.env.TAR_BIN || "tar";
  const child = startChild(command, ["-xzf", "-", "-C", destination, "--no-same-owner", "--no-same-permissions"], env, { stdin: "pipe" });
  const getStderr = captureStderr(child);
  const exited = childExit(child, "tar extraction", getStderr);
  try {
    await Promise.all([pipeline(createReadStream(encryptedPath), createDecryptionStream(key), child.stdin), exited]);
  } catch (error) {
    child.kill();
    await exited.catch(() => undefined);
    throw error;
  }
}

export async function verifyManifestArtifact(root, entry, expectedName) {
  if (!entry || entry.file !== expectedName || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) throw new Error("Backup manifest contains an invalid artifact record.");
  const path = resolve(root, expectedName);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Backup artifact ${expectedName} is missing or not a regular file.`);
  const actual = await sha256File(path);
  if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error(`Backup artifact ${expectedName} failed its manifest checksum.`);
  return path;
}

export async function readBackupManifest(backupPath) {
  const info = await lstat(backupPath).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error("Backup path must be a non-symlink directory.");
  const manifestPath = resolve(backupPath, MANIFEST_NAME);
  const manifestInfo = await lstat(manifestPath).catch(() => null);
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024) throw new Error("Backup manifest is missing or invalid.");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { throw new Error("Backup manifest is not valid JSON."); }
  if (manifest.formatVersion !== 1 || manifest.encryption !== "AES-256-GCM" || !Number.isSafeInteger(manifest.attachmentCount) || manifest.attachmentCount < 0) throw new Error("Backup manifest version or metadata is not supported.");
  if (!manifest.database || !Number.isSafeInteger(manifest.database.bytes) || !/^[a-f0-9]{64}$/.test(manifest.database.sha256 ?? "")) throw new Error("Backup manifest is missing database artifact metadata.");
  if (manifest.attachmentCount === 0 && manifest.attachments !== null) throw new Error("Backup manifest has inconsistent attachment metadata.");
  if (manifest.attachmentCount > 0 && (!manifest.attachments || manifest.attachments.file !== ATTACHMENTS_BACKUP_NAME)) throw new Error("Backup manifest is missing its attachment archive.");
  return manifest;
}

export async function verifyAttachmentSet(root, env, expectedCount) {
  let count = 0;
  await runQueryLines(env, "SELECT storage_key, bytes::text, checksum FROM attachments ORDER BY storage_key", async (line) => {
    const [storageKey, bytes, checksum, extra] = line.split("\t");
    if (!storageKey || bytes === undefined || checksum === undefined || extra !== undefined) throw new Error("PostgreSQL returned invalid attachment metadata.");
    await verifyAttachmentFile(root, { storageKey, bytes, checksum });
    count += 1;
  });
  if (count !== expectedCount) throw new Error(`Expected ${expectedCount} attachment rows but found ${count}.`);
  return count;
}

export async function restoreAttachmentRowsToSet(env) {
  const rows = [];
  await runQueryLines(env, "SELECT storage_key, bytes::text, checksum FROM attachments ORDER BY storage_key", (line) => {
    const [storageKey, bytes, checksum, extra] = line.split("\t");
    if (!storageKey || bytes === undefined || checksum === undefined || extra !== undefined) throw new Error("PostgreSQL returned invalid attachment metadata.");
    rows.push({ storageKey, bytes, checksum });
  });
  return rows;
}

export async function validateEmptyRestoreDatabase(env) {
  const objects = await querySingleValue(env, "SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m','S','f')");
  const extraSchemas = await querySingleValue(env, "SELECT count(*)::text FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
  if (!/^\d+$/.test(objects) || BigInt(objects) !== 0n || !/^\d+$/.test(extraSchemas) || BigInt(extraSchemas) !== 0n) throw new Error("Restore target is not empty; refusing to overwrite database objects.");
}

export function validateLoopbackRestoreUrl(parsed, confirmation) {
  const host = parsed.host.toLowerCase();
  const loopback = host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!loopback) throw new Error("Restore is restricted to a loopback PostgreSQL host.");
  if (!/^shopro_restore_[a-z0-9_]{3,40}$/i.test(parsed.database) || confirmation !== parsed.database) {
    throw new Error("Set RESTORE_CONFIRM_DATABASE to the exact disposable database name beginning with shopro_restore_.");
  }
}

export async function verifyRestoredAttachmentRows(root, rows, expectedCount) {
  if (rows.length !== expectedCount) throw new Error(`Restored attachment row count ${rows.length} does not match expected ${expectedCount}.`);
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.storageKey)) throw new Error("Restored database contains duplicate attachment storage keys.");
    seen.add(row.storageKey);
    await verifyAttachmentFile(root, row);
  }
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root, { withFileTypes: true }));
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  if (entries.some((entry) => !entry.isFile() || !seen.has(entry.name)) || files.length !== seen.size) throw new Error("Restored attachment directory contains an unexpected path or file.");
}

export async function createTempDirectory(parent, prefix) {
  const path = resolve(parent, `${prefix}${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path, { mode: 0o700 });
  return path;
}

export async function removeOwnedTempDirectory(path, parent, prefix) {
  if (!path || !isWithin(parent, path) || resolve(path) === resolve(parent) || !path.slice(resolve(parent).length + 1).startsWith(prefix)) return;
  await rm(path, { recursive: true, force: true });
}

export async function artifactInfo(path, file) {
  const info = await stat(path);
  const hash = await sha256File(path);
  return { file, bytes: info.size, sha256: hash.sha256 };
}

export async function ensureArtifactDirectory(path) {
  const absolute = requireAbsolutePath(path, "BACKUP_DIR");
  assertOutsidePublicRoots(absolute, "BACKUP_DIR");
  if (isWithin(process.cwd(), absolute)) throw new Error("BACKUP_DIR must be outside the application repository.");
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  return ensurePrivateDirectory(absolute, { label: "BACKUP_DIR" });
}

export async function writeManifest(path, manifest) {
  await writePrivateFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function renameDirectory(source, destination) {
  await rename(source, destination);
}

export async function deleteFile(path) {
  await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
}
