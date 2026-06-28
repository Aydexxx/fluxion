import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

const app = createApp();

const SECRET_TOKEN = "sk-supersecret-do-not-leak";
const SMTP_PASSWORD = "smtp-pw-never-show";

beforeEach(async () => {
  await prisma.credential.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

async function registerUser(email: string): Promise<{ token: string; workspaceId: string; userId: string }> {
  const res = await request(app).post("/auth/register").send({ name: "User", email, password: "Password123!" });
  return { token: res.body.token, workspaceId: res.body.workspace.id, userId: res.body.user.id };
}

describe("POST /credentials", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/credentials").send({ workspaceId: "x", name: "n", type: "http_bearer", data: {} });
    expect(res.status).toBe(401);
  });

  it("creates a credential and returns only safe metadata (no secret)", async () => {
    const { token, workspaceId } = await registerUser("a@x.com");
    const res = await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({ workspaceId, name: "My API key", type: "http_bearer", data: { token: SECRET_TOKEN } });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "My API key", type: "http_bearer", last4: SECRET_TOKEN.slice(-4) });
    expect(res.body.meta).toEqual({}); // token is secret, so no meta
    expect(JSON.stringify(res.body)).not.toContain(SECRET_TOKEN);
  });

  it("returns non-secret SMTP fields as meta but never the password", async () => {
    const { token, workspaceId } = await registerUser("b@x.com");
    const res = await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({
        workspaceId,
        name: "Mailer",
        type: "smtp",
        data: { host: "smtp.x.com", port: "587", username: "u", password: SMTP_PASSWORD, from: "bot@x.com" },
      });

    expect(res.status).toBe(201);
    expect(res.body.meta).toMatchObject({ host: "smtp.x.com", port: "587", username: "u", from: "bot@x.com" });
    expect(JSON.stringify(res.body)).not.toContain(SMTP_PASSWORD);
  });

  it("rejects a missing required field", async () => {
    const { token, workspaceId } = await registerUser("c@x.com");
    const res = await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({ workspaceId, name: "bad", type: "smtp", data: { host: "smtp.x.com" } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/required/);
  });

  it("rejects an unknown credential type", async () => {
    const { token, workspaceId } = await registerUser("d@x.com");
    const res = await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({ workspaceId, name: "bad", type: "mystery", data: {} });
    expect(res.status).toBe(400);
  });
});

describe("GET /credentials", () => {
  it("lists workspace credentials without secrets", async () => {
    const { token, workspaceId } = await registerUser("e@x.com");
    await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({ workspaceId, name: "K", type: "http_bearer", data: { token: SECRET_TOKEN } });

    const res = await request(app).get("/credentials").query({ workspaceId }).set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_TOKEN);
  });

  it("does not expose credentials from another user's workspace", async () => {
    const alice = await registerUser("alice@x.com");
    const bob = await registerUser("bob@x.com");
    await request(app)
      .post("/credentials")
      .set(...auth(alice.token))
      .send({ workspaceId: alice.workspaceId, name: "K", type: "http_bearer", data: { token: SECRET_TOKEN } });

    const res = await request(app).get("/credentials").query({ workspaceId: alice.workspaceId }).set(...auth(bob.token));
    expect(res.status).toBe(403);
  });
});

describe("GET /credentials/types", () => {
  it("returns the credential type catalog", async () => {
    const { token } = await registerUser("f@x.com");
    const res = await request(app).get("/credentials/types").set(...auth(token));
    expect(res.status).toBe(200);
    const types = res.body.map((t: { type: string }) => t.type);
    expect(types).toEqual(expect.arrayContaining(["http_bearer", "smtp", "openai", "slack_webhook", "database"]));
  });
});

describe("PUT /credentials/:id", () => {
  it("rotates the secret and updates last4, still hiding the value", async () => {
    const { token, workspaceId } = await registerUser("g@x.com");
    const created = await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({ workspaceId, name: "K", type: "http_bearer", data: { token: SECRET_TOKEN } });

    const res = await request(app)
      .put(`/credentials/${created.body.id}`)
      .set(...auth(token))
      .send({ name: "Renamed", data: { token: "sk-rotated-9999" } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", last4: "9999" });
    expect(JSON.stringify(res.body)).not.toContain("sk-rotated-9999");
  });
});

describe("DELETE /credentials/:id", () => {
  it("deletes a credential (owner is admin-rank)", async () => {
    const { token, workspaceId } = await registerUser("h@x.com");
    const created = await request(app)
      .post("/credentials")
      .set(...auth(token))
      .send({ workspaceId, name: "K", type: "http_bearer", data: { token: SECRET_TOKEN } });

    const del = await request(app).delete(`/credentials/${created.body.id}`).set(...auth(token));
    expect(del.status).toBe(204);

    const list = await request(app).get("/credentials").query({ workspaceId }).set(...auth(token));
    expect(list.body).toHaveLength(0);
  });

  it("returns 404 for a credential that doesn't exist", async () => {
    const { token } = await registerUser("i@x.com");
    const res = await request(app).delete("/credentials/does-not-exist").set(...auth(token));
    expect(res.status).toBe(404);
  });

  it("rejects deletion by an editor (requires admin rank)", async () => {
    const owner = await registerUser("j@x.com");
    const member = await registerUser("k@x.com");
    await prisma.workspaceMember.create({
      data: { userId: member.userId, workspaceId: owner.workspaceId, role: "editor" },
    });
    const created = await request(app)
      .post("/credentials")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, name: "K", type: "http_bearer", data: { token: SECRET_TOKEN } });

    const del = await request(app).delete(`/credentials/${created.body.id}`).set(...auth(member.token));
    expect(del.status).toBe(403);
  });
});

describe("PUT /credentials/:id — not found", () => {
  it("returns 404 for a credential that doesn't exist", async () => {
    const { token } = await registerUser("l@x.com");
    const res = await request(app).put("/credentials/does-not-exist").set(...auth(token)).send({ name: "x" });
    expect(res.status).toBe(404);
  });
});
