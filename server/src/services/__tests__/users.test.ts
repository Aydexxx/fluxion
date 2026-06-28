import { describe, expect, it } from "vitest";
import type { User as PrismaUser } from "../../generated/prisma/client";
import { parsePreferences, toSafeUser } from "../users";

describe("parsePreferences", () => {
  it("keeps a valid defaultLanding", () => {
    expect(parsePreferences({ defaultLanding: "runs" })).toEqual({ defaultLanding: "runs" });
  });

  it("drops unknown landings and junk shapes", () => {
    expect(parsePreferences({ defaultLanding: "spaceship" })).toEqual({});
    expect(parsePreferences({ defaultLanding: 42 })).toEqual({});
    expect(parsePreferences(null)).toEqual({});
    expect(parsePreferences("nope")).toEqual({});
    expect(parsePreferences(undefined)).toEqual({});
  });

  it("ignores extra unknown keys", () => {
    expect(parsePreferences({ defaultLanding: "analytics", evil: "<script>" })).toEqual({
      defaultLanding: "analytics",
    });
  });
});

describe("toSafeUser", () => {
  const row: PrismaUser = {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    passwordHash: "$2a$10$secret-hash-should-never-leak",
    avatarUrl: "data:image/png;base64,abc",
    preferences: { defaultLanding: "templates" },
    createdAt: new Date("2026-06-28T00:00:00.000Z"),
  } as PrismaUser;

  it("exposes profile fields but never the password hash", () => {
    const safe = toSafeUser(row);
    expect(safe).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      avatarUrl: "data:image/png;base64,abc",
      preferences: { defaultLanding: "templates" },
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    expect(JSON.stringify(safe)).not.toContain("secret-hash");
  });

  it("normalizes a missing avatar/preferences", () => {
    const safe = toSafeUser({ ...row, avatarUrl: null, preferences: null } as PrismaUser);
    expect(safe.avatarUrl).toBeNull();
    expect(safe.preferences).toEqual({});
  });
});
