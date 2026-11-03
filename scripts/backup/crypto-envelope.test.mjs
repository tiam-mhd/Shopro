import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { createDecryptionStream, createEncryptionStream, parseBackupKey } from "./crypto-envelope.mjs";

async function roundTrip(clearBytes, key) {
  const folder = await mkdtemp(join(tmpdir(), "shopro-backup-crypto-"));
  try {
    const encryptedPath = join(folder, "archive.enc");
    const decryptedPath = join(folder, "archive.clear");
    const chunks = [];
    for (let offset = 0; offset < clearBytes.length; offset += 7) chunks.push(clearBytes.subarray(offset, offset + 7));
    await pipeline(Readable.from(chunks), createEncryptionStream(key), await import("node:fs").then(({ createWriteStream }) => createWriteStream(encryptedPath)));
    await pipeline(await import("node:fs").then(({ createReadStream }) => createReadStream(encryptedPath)), createDecryptionStream(key), await import("node:fs").then(({ createWriteStream }) => createWriteStream(decryptedPath)));
    return { encrypted: await readFile(encryptedPath), decrypted: await readFile(decryptedPath) };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("backup encryption round-trips arbitrary binary data across short stream chunks", async () => {
  const clear = randomBytes(128 * 1024 + 3);
  const result = await roundTrip(clear, randomBytes(32));
  assert.deepEqual(result.decrypted, clear);
  assert.notDeepEqual(result.encrypted, clear);
});

test("backup encryption rejects malformed keys, modified ciphertext, wrong keys, and truncation", async () => {
  assert.throws(() => parseBackupKey("not-a-key"), /32-byte/);
  const key = randomBytes(32);
  const result = await roundTrip(Buffer.from("private financial data"), key);
  const folder = await mkdtemp(join(tmpdir(), "shopro-backup-crypto-reject-"));
  try {
    const sourcePath = join(folder, "tampered.enc");
    const outputPath = join(folder, "clear.out");
    await writeFile(sourcePath, result.encrypted);
    await assert.rejects(pipeline(await import("node:fs").then(({ createReadStream }) => createReadStream(sourcePath)), createDecryptionStream(randomBytes(32)), await import("node:fs").then(({ createWriteStream }) => createWriteStream(outputPath))));
    const tampered = Buffer.from(result.encrypted);
    tampered[tampered.length - 17] ^= 1;
    await writeFile(sourcePath, tampered);
    await assert.rejects(pipeline(await import("node:fs").then(({ createReadStream }) => createReadStream(sourcePath)), createDecryptionStream(key), await import("node:fs").then(({ createWriteStream }) => createWriteStream(outputPath))));
    await writeFile(sourcePath, result.encrypted.subarray(0, result.encrypted.length - 3));
    await assert.rejects(pipeline(await import("node:fs").then(({ createReadStream }) => createReadStream(sourcePath)), createDecryptionStream(key), await import("node:fs").then(({ createWriteStream }) => createWriteStream(outputPath))));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
