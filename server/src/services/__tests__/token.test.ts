import { describe, expect, it } from "vitest";
import { generateWebhookToken } from "../token";

describe("generateWebhookToken", () => {
  it("produces a long, URL-safe token (unguessable entropy)", () => {
    const token = generateWebhookToken();
    // 32 random bytes -> ~43 base64url chars; URL-safe alphabet only.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is unique across many generations (no collisions)", () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateWebhookToken()));
    expect(tokens.size).toBe(2000);
  });
});
