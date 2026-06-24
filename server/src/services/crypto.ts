import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for credential secrets at rest (AES-256-GCM).
 *
 * GCM is authenticated encryption: every ciphertext carries an auth tag, so a
 * tampered or truncated payload fails to decrypt instead of yielding garbage.
 * The packed format is a single self-describing string —
 * `v1:<iv>:<authTag>:<ciphertext>`, each part base64 — so the database column
 * stays a plain `TEXT` and the version prefix leaves room to rotate the scheme
 * later without guessing how to read old rows.
 *
 * The key never lives in the database. It comes from the `CREDENTIALS_KEY`
 * environment variable (see README → "Credential encryption key management").
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const VERSION = "v1";

/**
 * Decodes and validates the master key from its env representation. Accepts a
 * 64-char hex string or a base64 string; either way it must decode to exactly
 * 32 bytes. Throws a clear, actionable error otherwise so a misconfigured key
 * fails loudly at startup rather than silently corrupting secrets.
 */
export function loadEncryptionKey(raw: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/** Encrypts UTF-8 plaintext into the packed `v1:iv:tag:ciphertext` form. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reverses {@link encryptSecret}. Throws if the payload is malformed or fails authentication (wrong key / tampered). */
export function decryptSecret(packed: string, key: Buffer): string {
  const parts = packed.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted credential payload");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
