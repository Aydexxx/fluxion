import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

const app = createApp();

beforeEach(async () => {
  await prisma.apiKey.deleteMany();
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

/** Adds an existing user to a workspace with a specific role (bypasses the invite flow). */
async function addMember(workspaceId: string, userId: string, role: "admin" | "editor" | "viewer") {
  await prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
}

describe("POST /workspaces/:id/api-keys", () => {
  it("creates a scoped key and returns the plaintext exactly once", async () => {
    const owner = await registerUser("owner@x.com");
    const res = await request(app)
      .post(`/workspaces/${owner.workspaceId}/api-keys`)
      .set(...auth(owner.token))
      .send({ name: "CI bot", scopes: ["workflows:read", "workflows:run"] });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("CI bot");
    expect(res.body.scopes).toEqual(["workflows:read", "workflows:run"]);
    expect(typeof res.body.key).toBe("string");
    expect(res.body.key).toMatch(/^flux_/);
    expect(res.body.prefix.startsWith("flux_")).toBe(true);
    // The stored secret must be a hash, never the plaintext.
    const stored = await prisma.apiKey.findUnique({ where: { id: res.body.id } });
    expect(stored?.hashedKey).toBeTruthy();
    expect(stored?.hashedKey).not.toBe(res.body.key);
  });

  it("never returns the key or hash on subsequent list", async () => {
    const owner = await registerUser("owner2@x.com");
    await request(app)
      .post(`/workspaces/${owner.workspaceId}/api-keys`)
      .set(...auth(owner.token))
      .send({ name: "k", scopes: ["workflows:read"] });

    const list = await request(app).get(`/workspaces/${owner.workspaceId}/api-keys`).set(...auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty("key");
    expect(list.body[0]).not.toHaveProperty("hashedKey");
    expect(list.body[0].lastUsedAt).toBeNull();
  });

  it("rejects an empty scope list", async () => {
    const owner = await registerUser("owner3@x.com");
    const res = await request(app)
      .post(`/workspaces/${owner.workspaceId}/api-keys`)
      .set(...auth(owner.token))
      .send({ name: "k", scopes: [] });
    expect(res.status).toBe(400);
  });

  it("forbids a non-admin member from managing keys", async () => {
    const owner = await registerUser("owner4@x.com");
    const editor = await registerUser("editor4@x.com");
    await addMember(owner.workspaceId, editor.userId, "editor");

    const create = await request(app)
      .post(`/workspaces/${owner.workspaceId}/api-keys`)
      .set(...auth(editor.token))
      .send({ name: "k", scopes: ["workflows:read"] });
    expect(create.status).toBe(403);

    const list = await request(app).get(`/workspaces/${owner.workspaceId}/api-keys`).set(...auth(editor.token));
    expect(list.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(`/workspaces/ws_x/api-keys`);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /workspaces/:id/api-keys/:keyId (revoke)", () => {
  it("revokes a key so it no longer appears, and a second revoke 404s", async () => {
    const owner = await registerUser("owner5@x.com");
    const created = await request(app)
      .post(`/workspaces/${owner.workspaceId}/api-keys`)
      .set(...auth(owner.token))
      .send({ name: "to-revoke", scopes: ["workflows:read"] });
    const keyId = created.body.id as string;

    const revoke = await request(app).delete(`/workspaces/${owner.workspaceId}/api-keys/${keyId}`).set(...auth(owner.token));
    expect(revoke.status).toBe(204);

    const list = await request(app).get(`/workspaces/${owner.workspaceId}/api-keys`).set(...auth(owner.token));
    expect(list.body).toHaveLength(0);

    const again = await request(app).delete(`/workspaces/${owner.workspaceId}/api-keys/${keyId}`).set(...auth(owner.token));
    expect(again.status).toBe(404);
  });
});
