import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Transform } from "node:stream";

const MAGIC = Buffer.from("SHOPROBK", "ascii");
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES;

export function parseBackupKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function createEncryptionStream(key) {
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) throw new Error("A 32-byte backup key is required.");
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);

  return new Transform({
    transform(chunk, _encoding, callback) {
      try { callback(null, cipher.update(chunk)); } catch (error) { callback(error); }
    },
    flush(callback) {
      try {
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        callback();
      } catch (error) { callback(error); }
    },
    construct(callback) {
      this.push(header);
      callback();
    },
  });
}

export function createDecryptionStream(key) {
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) throw new Error("A 32-byte backup key is required.");
  let header = Buffer.alloc(0);
  let trailing = Buffer.alloc(0);
  let decipher;

  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        let payload = chunk;
        if (!decipher) {
          const needed = HEADER_BYTES - header.byteLength;
          const take = Math.min(needed, payload.byteLength);
          header = Buffer.concat([header, payload.subarray(0, take)]);
          payload = payload.subarray(take);
          if (header.byteLength === HEADER_BYTES) {
            if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header[MAGIC.length] !== VERSION) {
              throw new Error("Backup encryption header is not recognized.");
            }
            const iv = header.subarray(MAGIC.length + 1);
            decipher = createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAAD(header);
          }
        }
        if (decipher && payload.byteLength) {
          const combined = Buffer.concat([trailing, payload]);
          if (combined.byteLength > TAG_BYTES) {
            const split = combined.byteLength - TAG_BYTES;
            const clear = decipher.update(combined.subarray(0, split));
            if (clear.byteLength) this.push(clear);
            trailing = combined.subarray(split);
          } else {
            trailing = combined;
          }
        }
        callback();
      } catch (error) { callback(error); }
    },
    flush(callback) {
      try {
        if (!decipher || header.byteLength !== HEADER_BYTES || trailing.byteLength !== TAG_BYTES) {
          throw new Error("Encrypted backup is truncated or malformed.");
        }
        decipher.setAuthTag(trailing);
        const clear = decipher.final();
        if (clear.byteLength) this.push(clear);
        callback();
      } catch (error) { callback(error); }
    },
  });
}
