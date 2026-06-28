import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";
import { resolveWorkspaceVariables } from "../services/variables";

const app = createApp();

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

interface Registered {
  token: string;
  userId: string;
  email: string;
  workspaceId: string;
}

let emailSeq = 0;
async function registerUser(name: string): Promise<Registered> {
  emailSeq += 1;
  const email = `vars${emailSeq}@example.com`;
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, email, workspaceId: res.body.workspace.id };
}

function invite(token: string, workspaceId: string, email: string, role: string) {
  return request(app).post(`/workspaces/${workspaceId}/invites`).set(...auth(token)).send({ email, role });
}

async function join(ownerToken: string, workspaceId: string, user: Registered, role: string) {
  await invite(ownerToken, workspaceId, user.email, role);
  const inviteId = (await request(app).get("/invites").set(...auth(user.token))).body[0].id;
  await request(app).post(`/invites/${inviteId}/accept`).set(...auth(user.token));
}

/* ── Variables (plain) ────────────────────────────────────────────────────── */

describe("variables: CRUD", () => {
  it("creates, lists, updates, and deletes a variable, returning its value", async () => {
    const owner = await registerUser("Owner");

    const created = await request(app)
      .post("/variables")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, key: "BASE_URL", value: "https://api.example.com" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: "BASE_URL", value: "https://api.example.com" });

    const list = await request(app).get("/variables").query({ workspaceId: owner.workspaceId }).set(...auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].value).toBe("https://api.example.com");

    const updated = await request(app)
      .put(`/variables/${created.body.id}`)
      .set(...auth(owner.token))
      .send({ value: "https://api.example.com/v2" });
    expect(updated.body.value).toBe("https://api.example.com/v2");

    const del = await request(app).delete(`/variables/${created.body.id}`).set(...auth(owner.token));
    expect(del.status).toBe(204);
    const after = await request(app).get("/variables").query({ workspaceId: owner.workspaceId }).set(...auth(owner.token));
    expect(after.body).toHaveLength(0);
  });

  it("rejects a duplicate key in the same workspace", async () => {
    const owner = await registerUser("Owner");
    await request(app).post("/variables").set(...auth(owner.token)).send({ workspaceId: owner.workspaceId, key: "K", value: "1" });
    const dup = await request(app).post("/variables").set(...auth(owner.token)).send({ workspaceId: owner.workspaceId, key: "K", value: "2" });
    expect(dup.status).toBe(400);
  });

  it("rejects an invalid key shape", async () => {
    const owner = await registerUser("Owner");
    for (const key of ["1BAD", "has space", "has.dot", "has-dash"]) {
      const res = await request(app)
        .post("/variables")
        .set(...auth(owner.token))
        .send({ workspaceId: owner.workspaceId, key, value: "x" });
      expect(res.status, key).toBe(400);
    }
  });
});

/* ── Secrets (encrypted, masked) ──────────────────────────────────────────── */

describe("secrets: masking + encryption at rest", () => {
  it("never returns a secret's value in create/list/update responses", async () => {
    const owner = await registerUser("Owner");

    const created = await request(app)
      .post("/secrets")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, key: "API_TOKEN", value: "sk-super-secret" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: "API_TOKEN" });
    expect(created.body.value).toBeUndefined();
    expect(created.body.encryptedValue).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toContain("sk-super-secret");

    const list = await request(app).get("/secrets").query({ workspaceId: owner.workspaceId }).set(...auth(owner.token));
    expect(list.body[0]).toMatchObject({ key: "API_TOKEN" });
    expect(list.body[0].value).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain("sk-super-secret");
  });

  it("stores the secret encrypted at rest, decryptable only via the resolver", async () => {
    const owner = await registerUser("Owner");
    await request(app)
      .post("/secrets")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, key: "API_TOKEN", value: "plain-value-123" });

    // The stored column is ciphertext (packed AES-GCM), never the plaintext.
    const row = await prisma.workspaceSecret.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(row.encryptedValue).not.toContain("plain-value-123");
    expect(row.encryptedValue.startsWith("v1:")).toBe(true);

    // The execution-time resolver (worker / node test) decrypts it back.
    const resolved = await resolveWorkspaceVariables(owner.workspaceId);
    expect(resolved.secrets.API_TOKEN).toBe("plain-value-123");
  });

  it("rotates a secret's value on update, and renames without losing the value", async () => {
    const owner = await registerUser("Owner");
    const created = await request(app)
      .post("/secrets")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, key: "TOKEN", value: "original" });

    // Rotate the value.
    await request(app).put(`/secrets/${created.body.id}`).set(...auth(owner.token)).send({ value: "rotated" });
    expect((await resolveWorkspaceVariables(owner.workspaceId)).secrets.TOKEN).toBe("rotated");

    // Rename only (no value) keeps the current secret.
    const renamed = await request(app).put(`/secrets/${created.body.id}`).set(...auth(owner.token)).send({ key: "RENAMED" });
    expect(renamed.body.key).toBe("RENAMED");
    const resolved = await resolveWorkspaceVariables(owner.workspaceId);
    expect(resolved.secrets.RENAMED).toBe("rotated");
    expect(resolved.secrets.TOKEN).toBeUndefined();
  });
});

/* ── Resolution shape ─────────────────────────────────────────────────────── */

describe("resolveWorkspaceVariables", () => {
  it("returns vars and decrypted secrets as flat key maps, scoped to the workspace", async () => {
    const owner = await registerUser("Owner");
    const other = await registerUser("Other");
    await request(app).post("/variables").set(...auth(owner.token)).send({ workspaceId: owner.workspaceId, key: "ENV", value: "prod" });
    await request(app).post("/secrets").set(...auth(owner.token)).send({ workspaceId: owner.workspaceId, key: "KEY", value: "s3cr3t" });
    // A value in another workspace must not leak in.
    await request(app).post("/variables").set(...auth(other.token)).send({ workspaceId: other.workspaceId, key: "ENV", value: "dev" });

    const resolved = await resolveWorkspaceVariables(owner.workspaceId);
    expect(resolved).toEqual({ vars: { ENV: "prod" }, secrets: { KEY: "s3cr3t" } });
  });
});

/* ── RBAC ─────────────────────────────────────────────────────────────────── */

describe("variables/secrets: RBAC", () => {
  it("lets any member read, but only editors+ write", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Viewer");
    await join(owner.token, owner.workspaceId, viewer, "viewer");

    // Viewer can list.
    expect((await request(app).get("/variables").query({ workspaceId: owner.workspaceId }).set(...auth(viewer.token))).status).toBe(200);
    expect((await request(app).get("/secrets").query({ workspaceId: owner.workspaceId }).set(...auth(viewer.token))).status).toBe(200);

    // Viewer cannot create.
    const v = await request(app).post("/variables").set(...auth(viewer.token)).send({ workspaceId: owner.workspaceId, key: "K", value: "x" });
    expect(v.status).toBe(403);
    const s = await request(app).post("/secrets").set(...auth(viewer.token)).send({ workspaceId: owner.workspaceId, key: "K", value: "x" });
    expect(s.status).toBe(403);
  });

  it("requires admin to delete (editor is forbidden)", async () => {
    const owner = await registerUser("Owner");
    const editor = await registerUser("Editor");
    await join(owner.token, owner.workspaceId, editor, "editor");

    const created = await request(app)
      .post("/variables")
      .set(...auth(editor.token))
      .send({ workspaceId: owner.workspaceId, key: "K", value: "x" });
    expect(created.status).toBe(201); // editor can create

    // …but not delete.
    expect((await request(app).delete(`/variables/${created.body.id}`).set(...auth(editor.token))).status).toBe(403);
    // The owner (admin-tier) can.
    expect((await request(app).delete(`/variables/${created.body.id}`).set(...auth(owner.token))).status).toBe(204);
  });

  it("forbids a non-member from reading or writing", async () => {
    const owner = await registerUser("Owner");
    const stranger = await registerUser("Stranger");
    expect((await request(app).get("/secrets").query({ workspaceId: owner.workspaceId }).set(...auth(stranger.token))).status).toBe(403);
    const res = await request(app)
      .post("/secrets")
      .set(...auth(stranger.token))
      .send({ workspaceId: owner.workspaceId, key: "K", value: "x" });
    expect(res.status).toBe(403);
  });
});
