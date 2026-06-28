import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

// Workflow create/run reconcile cron schedules; stub so these tests need only Postgres.
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));
// Manual runs enqueue onto BullMQ/Redis; stub the enqueue so role checks are tested without Redis.
vi.mock("../queue/workflowQueue", () => ({
  enqueueWorkflowRun: vi.fn(async () => {}),
}));

const app = createApp();

beforeEach(async () => {
  // Workspace cascades members/invites/workflows; users referenced by ownerId go last.
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
  const email = `user${emailSeq}@example.com`;
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, email, workspaceId: res.body.workspace.id };
}

/** Invite an email into a workspace at a role; returns the created invite body. */
function invite(token: string, workspaceId: string, email: string, role: string) {
  return request(app).post(`/workspaces/${workspaceId}/invites`).set(...auth(token)).send({ email, role });
}

/* ── Registration now reports the owner role ──────────────────────────────── */

describe("registration + workspace role", () => {
  it("makes the registering user an owner of their default workspace", async () => {
    const owner = await registerUser("Ada");
    const res = await request(app).get("/workspaces").set(...auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: owner.workspaceId, role: "owner" });
  });
});

/* ── Invite flow ──────────────────────────────────────────────────────────── */

describe("POST /workspaces/:id/invites", () => {
  it("invites an existing user, who then sees it in their pending invites", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");

    const res = await invite(owner.token, owner.workspaceId, invitee.email, "editor");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: invitee.email, role: "editor", invitedByName: "Owner" });

    const mine = await request(app).get("/invites").set(...auth(invitee.token));
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ workspaceId: owner.workspaceId, role: "editor", invitedByName: "Owner" });
  });

  it("creates a pending invite for an unknown email that resolves on signup", async () => {
    const owner = await registerUser("Owner");
    const res = await invite(owner.token, owner.workspaceId, "newcomer@example.com", "viewer");
    expect(res.status).toBe(201);

    // It shows on the members screen as a pending invite.
    const members = await request(app).get(`/workspaces/${owner.workspaceId}/members`).set(...auth(owner.token));
    expect(members.body.invites).toHaveLength(1);
    expect(members.body.invites[0].email).toBe("newcomer@example.com");

    // After the newcomer signs up with that email, the invite is waiting for them.
    const newcomer = await request(app)
      .post("/auth/register")
      .send({ name: "Newcomer", email: "newcomer@example.com", password: "Password123!" });
    const mine = await request(app).get("/invites").set(...auth(newcomer.body.token));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].workspaceId).toBe(owner.workspaceId);
  });

  it("rejects inviting someone who is already a member", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    await invite(owner.token, owner.workspaceId, member.email, "editor");
    const inviteId = (await request(app).get("/invites").set(...auth(member.token))).body[0].id;
    await request(app).post(`/invites/${inviteId}/accept`).set(...auth(member.token));

    const again = await invite(owner.token, owner.workspaceId, member.email, "viewer");
    expect(again.status).toBe(400);
  });

  it("forbids a viewer from inviting", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Viewer");
    await invite(owner.token, owner.workspaceId, viewer.email, "viewer");
    const mine = await request(app).get("/invites").set(...auth(viewer.token));
    await request(app).post(`/invites/${mine.body[0].id}/accept`).set(...auth(viewer.token));

    const res = await invite(viewer.token, owner.workspaceId, "another@example.com", "viewer");
    expect(res.status).toBe(403);
  });

  it("forbids an admin from granting the owner role via invite (schema-blocked)", async () => {
    const owner = await registerUser("Owner");
    const res = await invite(owner.token, owner.workspaceId, "x@example.com", "owner");
    expect(res.status).toBe(400); // owner is not an assignable invite role
  });
});

/* ── Acceptance / decline ─────────────────────────────────────────────────── */

describe("invite acceptance", () => {
  async function inviteAndGetId(ownerToken: string, workspaceId: string, email: string, role: string) {
    await invite(ownerToken, workspaceId, email, role);
    return email;
  }

  it("grants workspace access on acceptance", async () => {
    const owner = await registerUser("Owner");
    const editor = await registerUser("Editor");
    await inviteAndGetId(owner.token, owner.workspaceId, editor.email, "editor");

    // Before acceptance, the invitee cannot list that workspace's workflows.
    const before = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId })
      .set(...auth(editor.token));
    expect(before.status).toBe(403);

    const mine = await request(app).get("/invites").set(...auth(editor.token));
    const accept = await request(app).post(`/invites/${mine.body[0].id}/accept`).set(...auth(editor.token));
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ id: owner.workspaceId, role: "editor" });

    // After acceptance: access granted, and the workspace appears in their switcher.
    const after = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId })
      .set(...auth(editor.token));
    expect(after.status).toBe(200);

    const workspaces = await request(app).get("/workspaces").set(...auth(editor.token));
    expect(workspaces.body).toHaveLength(2); // their own + the joined one
    expect(workspaces.body.map((w: { id: string }) => w.id)).toContain(owner.workspaceId);

    // The invite no longer shows as pending.
    const pending = await request(app).get("/invites").set(...auth(editor.token));
    expect(pending.body).toHaveLength(0);
  });

  it("declining keeps the user out and clears the invite", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    await invite(owner.token, owner.workspaceId, invitee.email, "viewer");

    const mine = await request(app).get("/invites").set(...auth(invitee.token));
    const decline = await request(app).post(`/invites/${mine.body[0].id}/decline`).set(...auth(invitee.token));
    expect(decline.status).toBe(204);

    const after = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId })
      .set(...auth(invitee.token));
    expect(after.status).toBe(403);
    expect((await request(app).get("/invites").set(...auth(invitee.token))).body).toHaveLength(0);
  });

  it("forbids accepting an invite addressed to a different email", async () => {
    const owner = await registerUser("Owner");
    const intended = await registerUser("Intended");
    const interloper = await registerUser("Interloper");
    await invite(owner.token, owner.workspaceId, intended.email, "viewer");
    const inviteId = (await request(app).get("/invites").set(...auth(intended.token))).body[0].id;

    const res = await request(app).post(`/invites/${inviteId}/accept`).set(...auth(interloper.token));
    expect(res.status).toBe(403);
  });
});

/* ── Per-route role enforcement ───────────────────────────────────────────── */

describe("RBAC enforcement per route", () => {
  /** Sets up an owner workspace with a member at `role` (joined). */
  async function workspaceWithMember(role: "admin" | "editor" | "viewer") {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    await invite(owner.token, owner.workspaceId, member.email, role);
    const inviteId = (await request(app).get("/invites").set(...auth(member.token))).body[0].id;
    await request(app).post(`/invites/${inviteId}/accept`).set(...auth(member.token));
    return { owner, member };
  }

  const validDefinition = {
    nodes: [
      { id: "n1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
      { id: "n2", type: "action.http", position: { x: 100, y: 0 }, config: { url: "https://example.com" } },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2" }],
  };

  it("lets a viewer read but blocks create/edit/run/publish", async () => {
    const { owner, member } = await workspaceWithMember("viewer");

    // Read is allowed.
    const list = await request(app).get("/workflows").query({ workspaceId: owner.workspaceId }).set(...auth(member.token));
    expect(list.status).toBe(200);

    // Create is blocked.
    const create = await request(app)
      .post("/workflows")
      .set(...auth(member.token))
      .send({ workspaceId: owner.workspaceId, name: "Nope" });
    expect(create.status).toBe(403);

    // Owner makes a workflow the viewer then tries to edit/run/publish.
    const wf = await request(app)
      .post("/workflows")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, name: "WF" });
    const id = wf.body.id;

    const edit = await request(app).put(`/workflows/${id}`).set(...auth(member.token)).send({ definition: validDefinition });
    expect(edit.status).toBe(403);

    const run = await request(app).post(`/workflows/${id}/run`).set(...auth(member.token)).send({});
    expect(run.status).toBe(403);

    const publish = await request(app).post(`/workflows/${id}/publish`).set(...auth(member.token)).send({});
    expect(publish.status).toBe(403);
  });

  it("lets an editor create/edit/run/publish but not delete", async () => {
    const { owner, member } = await workspaceWithMember("editor");

    const create = await request(app)
      .post("/workflows")
      .set(...auth(member.token))
      .send({ workspaceId: owner.workspaceId, name: "Editor WF" });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const edit = await request(app).put(`/workflows/${id}`).set(...auth(member.token)).send({ definition: validDefinition });
    expect(edit.status).toBe(200);

    const run = await request(app).post(`/workflows/${id}/run`).set(...auth(member.token)).send({});
    expect(run.status).toBe(202);

    const publish = await request(app).post(`/workflows/${id}/publish`).set(...auth(member.token)).send({});
    expect(publish.status).toBe(201);

    // Delete is admin-tier.
    const del = await request(app).delete(`/workflows/${id}`).set(...auth(member.token));
    expect(del.status).toBe(403);
  });

  it("lets an editor manage credentials (create/edit) but not delete", async () => {
    const { owner, member } = await workspaceWithMember("editor");
    const create = await request(app)
      .post("/credentials")
      .set(...auth(member.token))
      .send({ workspaceId: owner.workspaceId, name: "Key", type: "http_bearer", data: { token: "sk-secret-1234" } });
    expect(create.status).toBe(201);

    const del = await request(app).delete(`/credentials/${create.body.id}`).set(...auth(member.token));
    expect(del.status).toBe(403);
  });

  it("blocks a viewer from creating credentials", async () => {
    const { owner, member } = await workspaceWithMember("viewer");
    const res = await request(app)
      .post("/credentials")
      .set(...auth(member.token))
      .send({ workspaceId: owner.workspaceId, name: "Key", type: "http_bearer", data: { token: "sk-secret-1234" } });
    expect(res.status).toBe(403);
  });
});

/* ── Member management rules ──────────────────────────────────────────────── */

describe("member management", () => {
  async function joined(owner: Registered, name: string, role: "admin" | "editor" | "viewer") {
    const u = await registerUser(name);
    await invite(owner.token, owner.workspaceId, u.email, role);
    const inviteId = (await request(app).get("/invites").set(...auth(u.token))).body[0].id;
    await request(app).post(`/invites/${inviteId}/accept`).set(...auth(u.token));
    return u;
  }

  it("lets an admin change roles but not touch owners", async () => {
    const owner = await registerUser("Owner");
    const admin = await joined(owner, "Admin", "admin");
    const viewer = await joined(owner, "Viewer", "viewer");

    // Admin promotes a viewer to editor.
    const promote = await request(app)
      .patch(`/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
      .set(...auth(admin.token))
      .send({ role: "editor" });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe("editor");

    // Admin cannot demote the owner.
    const demoteOwner = await request(app)
      .patch(`/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set(...auth(admin.token))
      .send({ role: "viewer" });
    expect(demoteOwner.status).toBe(403);

    // Admin cannot grant owner (above their own rank).
    const grantOwner = await request(app)
      .patch(`/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
      .set(...auth(admin.token))
      .send({ role: "owner" });
    expect(grantOwner.status).toBe(403);
  });

  it("forbids an editor from managing members at all", async () => {
    const owner = await registerUser("Owner");
    const editor = await joined(owner, "Editor", "editor");
    const viewer = await joined(owner, "Viewer", "viewer");

    const res = await request(app)
      .delete(`/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
      .set(...auth(editor.token));
    expect(res.status).toBe(403);
  });

  it("lets an admin remove a non-owner member", async () => {
    const owner = await registerUser("Owner");
    const admin = await joined(owner, "Admin", "admin");
    const viewer = await joined(owner, "Viewer", "viewer");

    const res = await request(app)
      .delete(`/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
      .set(...auth(admin.token));
    expect(res.status).toBe(204);

    const members = await request(app).get(`/workspaces/${owner.workspaceId}/members`).set(...auth(owner.token));
    expect(members.body.members.map((m: { userId: string }) => m.userId)).not.toContain(viewer.userId);
  });

  it("protects the last owner from demotion", async () => {
    const owner = await registerUser("Owner");
    const res = await request(app)
      .patch(`/workspaces/${owner.workspaceId}/members/${owner.userId}`)
      .set(...auth(owner.token))
      .send({ role: "editor" });
    expect(res.status).toBe(400);
  });

  it("resends and revokes a pending invite", async () => {
    const owner = await registerUser("Owner");
    const inv = await invite(owner.token, owner.workspaceId, "pending@example.com", "viewer");

    const resend = await request(app)
      .post(`/workspaces/${owner.workspaceId}/invites/${inv.body.id}/resend`)
      .set(...auth(owner.token));
    expect(resend.status).toBe(200);

    const revoke = await request(app)
      .delete(`/workspaces/${owner.workspaceId}/invites/${inv.body.id}`)
      .set(...auth(owner.token));
    expect(revoke.status).toBe(204);

    const members = await request(app).get(`/workspaces/${owner.workspaceId}/members`).set(...auth(owner.token));
    expect(members.body.invites).toHaveLength(0);
  });
});

/* ── Workspace create / delete ────────────────────────────────────────────── */

describe("workspace lifecycle", () => {
  it("creates a new workspace owned by the caller", async () => {
    const user = await registerUser("Multi");
    const res = await request(app).post("/workspaces").set(...auth(user.token)).send({ name: "Side Project" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Side Project", role: "owner" });

    const all = await request(app).get("/workspaces").set(...auth(user.token));
    expect(all.body).toHaveLength(2);
  });

  it("lets only an owner delete a workspace", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    await invite(owner.token, owner.workspaceId, admin.email, "admin");
    const inviteId = (await request(app).get("/invites").set(...auth(admin.token))).body[0].id;
    await request(app).post(`/invites/${inviteId}/accept`).set(...auth(admin.token));

    const adminDelete = await request(app)
      .delete(`/workspaces/${owner.workspaceId}`)
      .set(...auth(admin.token));
    expect(adminDelete.status).toBe(403);

    const ownerDelete = await request(app)
      .delete(`/workspaces/${owner.workspaceId}`)
      .set(...auth(owner.token));
    expect(ownerDelete.status).toBe(204);
  });
});
