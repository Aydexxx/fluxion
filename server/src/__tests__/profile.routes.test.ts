import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

const app = createApp();

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

let seq = 0;
async function registerUser(name = "Ada"): Promise<{ token: string; userId: string; email: string }> {
  seq += 1;
  const email = `prof${seq}@example.com`;
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, email };
}

// A tiny valid 1x1 PNG data URL.
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("PATCH /auth/profile", () => {
  it("updates the display name and preferences", async () => {
    const user = await registerUser("Ada");

    const res = await request(app)
      .patch("/auth/profile")
      .set(...authHeader(user.token))
      .send({ name: "Ada Lovelace", preferences: { defaultLanding: "runs" } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Ada Lovelace", preferences: { defaultLanding: "runs" } });

    // Persisted: /auth/me reflects it.
    const me = await request(app).get("/auth/me").set(...authHeader(user.token));
    expect(me.body).toMatchObject({ name: "Ada Lovelace", preferences: { defaultLanding: "runs" } });
  });

  it("rejects an unknown preference value", async () => {
    const user = await registerUser();
    const res = await request(app)
      .patch("/auth/profile")
      .set(...authHeader(user.token))
      .send({ preferences: { defaultLanding: "spaceship" } });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).patch("/auth/profile").send({ name: "Nobody" });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/password", () => {
  it("changes the password when the current one is correct", async () => {
    const user = await registerUser();

    const res = await request(app)
      .post("/auth/password")
      .set(...authHeader(user.token))
      .send({ currentPassword: "Password123!", newPassword: "BrandNew456?" });
    expect(res.status).toBe(204);

    // Old password no longer works; new one does.
    const oldLogin = await request(app).post("/auth/login").send({ email: user.email, password: "Password123!" });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/auth/login").send({ email: user.email, password: "BrandNew456?" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects a wrong current password (400, not 401, so the session survives)", async () => {
    const user = await registerUser();

    const res = await request(app)
      .post("/auth/password")
      .set(...authHeader(user.token))
      .send({ currentPassword: "WrongPassword", newPassword: "BrandNew456?" });

    expect(res.status).toBe(400);

    // The original password is unchanged.
    const login = await request(app).post("/auth/login").send({ email: user.email, password: "Password123!" });
    expect(login.status).toBe(200);
  });

  it("rejects a too-short new password", async () => {
    const user = await registerUser();
    const res = await request(app)
      .post("/auth/password")
      .set(...authHeader(user.token))
      .send({ currentPassword: "Password123!", newPassword: "short" });
    expect(res.status).toBe(400);
  });
});

describe("PUT / DELETE /auth/avatar", () => {
  it("stores and then exposes the avatar via /auth/me", async () => {
    const user = await registerUser();

    const put = await request(app)
      .put("/auth/avatar")
      .set(...authHeader(user.token))
      .send({ avatarUrl: PNG_1x1 });
    expect(put.status).toBe(200);
    expect(put.body.avatarUrl).toBe(PNG_1x1);

    const me = await request(app).get("/auth/me").set(...authHeader(user.token));
    expect(me.body.avatarUrl).toBe(PNG_1x1);

    const del = await request(app).delete("/auth/avatar").set(...authHeader(user.token));
    expect(del.status).toBe(200);
    expect(del.body.avatarUrl).toBeNull();
  });

  it("rejects a non-image data URL", async () => {
    const user = await registerUser();
    const res = await request(app)
      .put("/auth/avatar")
      .set(...authHeader(user.token))
      .send({ avatarUrl: "data:text/html;base64,PHNjcmlwdD4=" });
    expect(res.status).toBe(400);
  });
});

describe("avatar surfaces in members + audit", () => {
  it("includes the actor/member avatar after upload", async () => {
    const owner = await registerUser("Owner");
    await request(app)
      .put("/auth/avatar")
      .set(...authHeader(owner.token))
      .send({ avatarUrl: PNG_1x1 });

    // Discover the workspace id.
    const workspaces = await request(app).get("/workspaces").set(...authHeader(owner.token));
    const workspaceId = workspaces.body[0].id;

    const members = await request(app)
      .get(`/workspaces/${workspaceId}/members`)
      .set(...authHeader(owner.token));
    const me = members.body.members.find((m: { userId: string }) => m.userId === owner.userId);
    expect(me.avatarUrl).toBe(PNG_1x1);
  });
});
