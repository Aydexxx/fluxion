import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

const app = createApp();

beforeEach(async () => {
  // Workspace.ownerId has no cascade from User, so child rows must go first.
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST /auth/register", () => {
  it("creates a user, a default workspace, and returns a token", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ada Lovelace", email: "Ada@Example.com", password: "Password123!" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.workspace).toMatchObject({ name: "Ada Lovelace's Workspace", ownerId: res.body.user.id });
  });

  it("rejects a duplicate email", async () => {
    await request(app)
      .post("/auth/register")
      .send({ name: "Ada", email: "dup@example.com", password: "Password123!" });

    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ada Two", email: "dup@example.com", password: "Password123!" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects invalid input", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "", email: "not-an-email", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("workspace auto-creation", () => {
  it("grants the registering user the owner role on their default workspace", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Grace Hopper", email: "grace-ws@example.com", password: "Password123!" });

    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: res.body.user.id, workspaceId: res.body.workspace.id } },
    });

    expect(membership).toMatchObject({ role: "owner" });
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await request(app)
      .post("/auth/register")
      .send({ name: "Grace Hopper", email: "grace@example.com", password: "Password123!" });
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "grace@example.com", password: "Password123!" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe("grace@example.com");
  });

  it("rejects an incorrect password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "grace@example.com", password: "WrongPassword!" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown email", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "Password123!" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("GET /auth/me (auth middleware)", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid token", async () => {
    const res = await request(app).get("/auth/me").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns the current user with a valid token", async () => {
    const registerRes = await request(app)
      .post("/auth/register")
      .send({ name: "Linus Torvalds", email: "linus@example.com", password: "Password123!" });
    const { token } = registerRes.body;

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("linus@example.com");
    expect(res.body.passwordHash).toBeUndefined();
  });
});
