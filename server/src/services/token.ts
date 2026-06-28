import { createHash, randomBytes } from "node:crypto";

/**
 * Generates an unguessable URL-safe token for webhook endpoints. 32 random
 * bytes (~256 bits of entropy) rendered as base64url — far beyond brute force.
 */
export function generateWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Human-recognizable prefix on every Fluxion API key, so a leaked key is easy to spot/grep. */
export const API_KEY_PREFIX = "flux_";

/**
 * Mints a new API key: a high-entropy secret (`flux_<43 base64url chars>`), its
 * SHA-256 hash (what we store), and a non-secret display slice. The plaintext is
 * returned once to the caller and never persisted.
 */
export function generateApiKey(): { plaintext: string; hashedKey: string; prefix: string } {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, hashedKey: hashApiKey(plaintext), prefix: plaintext.slice(0, API_KEY_PREFIX.length + 6) };
}

/**
 * Hashes an API key for storage and lookup. SHA-256 (not bcrypt) is the right
 * tool here: the key is already 256 bits of randomness, so there's nothing to
 * brute-force, and a fast hash keeps per-request auth cheap. Hex-encoded so it
 * fits a plain unique TEXT column.
 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
