import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createRateLimiter } from "../rateLimit";

function appWithLimiter(max: number) {
  const app = express();
  app.use("/thing", createRateLimiter({ windowMs: 60_000, max }), (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createRateLimiter", () => {
  it("allows requests up to the limit, then responds 429 with the standard error shape", async () => {
    const app = appWithLimiter(2);

    expect((await request(app).get("/thing")).status).toBe(200);
    expect((await request(app).get("/thing")).status).toBe(200);

    const blocked = await request(app).get("/thing");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { message: expect.any(String), code: "RATE_LIMITED" } });
  });

  it("sets standard RateLimit headers", async () => {
    const app = appWithLimiter(5);
    const res = await request(app).get("/thing");
    expect(res.headers).toHaveProperty("ratelimit-limit");
  });
});
