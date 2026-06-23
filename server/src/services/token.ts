import { randomBytes } from "node:crypto";

/**
 * Generates an unguessable URL-safe token for webhook endpoints. 32 random
 * bytes (~256 bits of entropy) rendered as base64url — far beyond brute force.
 */
export function generateWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}
