import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createRateLimiter } from "../middleware/rateLimit";

/**
 * Per-key rate limiting in isolation (no DB). Mirrors how the public `/api/v1`
 * router wires the limiter: an upstream step resolves the API key onto the
 * request, and the limiter throttles by that key id — so two different keys get
 * independent budgets and one key tripping doesn't affect another.
 */
function appWithKeyedLimiter(max: number) {
  const app = express();
  // Stand in for requireApiKey: take the key id straight from a test header.
  app.use((req, _res, next) => {
    req.apiKey = { id: String(req.headers["x-test-key"] ?? "anon"), workspaceId: "w", scopes: [] };
    next();
  });
  app.use(createRateLimiter({ windowMs: 60_000, max, keyGenerator: (req) => req.apiKey?.id ?? "anon" }));
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("per-key rate limiting", () => {
  it("throttles a single key after it exceeds the limit", async () => {
    const app = appWithKeyedLimiter(2);

    const first = await request(app).get("/ping").set("X-Test-Key", "k1");
    const second = await request(app).get("/ping").set("X-Test-Key", "k1");
    const third = await request(app).get("/ping").set("X-Test-Key", "k1");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("keeps each key's budget independent", async () => {
    const app = appWithKeyedLimiter(2);

    // Exhaust k1's budget.
    await request(app).get("/ping").set("X-Test-Key", "k1");
    await request(app).get("/ping").set("X-Test-Key", "k1");
    const k1Blocked = await request(app).get("/ping").set("X-Test-Key", "k1");
    expect(k1Blocked.status).toBe(429);

    // A different key is unaffected.
    const k2 = await request(app).get("/ping").set("X-Test-Key", "k2");
    expect(k2.status).toBe(200);
  });
});
