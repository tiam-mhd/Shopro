import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseBackupKey } from "./crypto-envelope.mjs";
import { extractEncryptedTar, inspectEncryptedTar, parseDatabaseUrl, runEncryptedTar, validateLoopbackRestoreUrl } from "./backup-common.mjs";

function childEnvironment() {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP };
}

test("database URL conversion keeps credentials out of process arguments and preserves supported libpq settings", () => {
  const connection = parseDatabaseUrl("postgresql://backup%40user:p%3Ass%2Fword@127.0.0.1:5432/shopro_test?schema=public&sslmode=require", "DATABASE_URL");
  assert.equal(connection.database, "shopro_test");
  assert.equal(connection.username, "backup@user");
  assert.equal(connection.env.PGPASSWORD, "p:ss/word");
  assert.equal(connection.env.PGSSLMODE, "require");
  assert.equal(connection.env.DATABASE_URL, undefined);
  assert.throws(() => parseDatabaseUrl("https://127.0.0.1/database"), /must use postgres/);
});

test("restore target validation only permits explicitly confirmed loopback disposable databases", () => {
  const local = parseDatabaseUrl("postgresql://tester:sample@localhost:5432/shopro_restore_roundtrip", "RESTORE_DATABASE_URL");
  assert.doesNotThrow(() => validateLoopbackRestoreUrl(local, "shopro_restore_roundtrip"));
  assert.throws(() => validateLoopbackRestoreUrl(local, "shopro_restore_other"), /exact disposable/);
  const remote = parseDatabaseUrl("postgresql://tester:sample@db.example.invalid:5432/shopro_restore_roundtrip", "RESTORE_DATABASE_URL");
  assert.throws(() => validateLoopbackRestoreUrl(remote, "shopro_restore_roundtrip"), /loopback/);
  const wrongPrefix = parseDatabaseUrl("postgresql://tester:sample@localhost:5432/production", "RESTORE_DATABASE_URL");
  assert.throws(() => validateLoopbackRestoreUrl(wrongPrefix, "production"), /exact disposable/);
});

test("attachment tar archive encrypts, validates, extracts and preserves only opaque attachment paths", async () => {
  const folder = await mkdtemp(join(tmpdir(), "shopro-backup-tar-"));
  const source = join(folder, "source");
  const extracted = join(folder, "extracted");
  const namesPath = join(folder, "names.list");
  const archivePath = join(folder, "attachments.tar.gz.enc");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
  await import("node:fs/promises").then(({ mkdir }) => mkdir(extracted));
  const storageKey = "00000000-0000-4000-8000-000000000123.pdf";
  const fileBytes = Buffer.from("%PDF-1.7\nprivate receipt");
  const key = parseBackupKey(randomBytes(32).toString("base64"));
  try {
    await writeFile(join(source, storageKey), fileBytes, { mode: 0o600 });
    await writeFile(namesPath, `${storageKey}\0`, { mode: 0o600 });
    await runEncryptedTar(key, archivePath, childEnvironment(), source, namesPath);
    assert.deepEqual(await inspectEncryptedTar(key, archivePath, childEnvironment()), [storageKey]);
    await extractEncryptedTar(key, archivePath, childEnvironment(), extracted);
    assert.deepEqual(await readFile(join(extracted, storageKey)), fileBytes);
    await assert.rejects(inspectEncryptedTar(randomBytes(32), archivePath, childEnvironment()));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
