import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

// Workflow create/delete reconcile cron schedules; stub so these tests need only Postgres.
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));

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
  const email = `audit${emailSeq}@example.com`;
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

function getAudit(token: string, workspaceId: string, query: Record<string, string> = {}) {
  return request(app).get(`/workspaces/${workspaceId}/audit-log`).query(query).set(...auth(token));
}

describe("audit log: events recorded", () => {
  it("records key actions (invite, workflow create) with actor + target", async () => {
    const owner = await registerUser("Ada");
    await invite(owner.token, owner.workspaceId, "newcomer@example.com", "editor");
    await request(app)
      .post("/workflows")
      .set(...auth(owner.token))
      .send({ workspaceId: owner.workspaceId, name: "My Flow" });

    const res = await getAudit(owner.token, owner.workspaceId);
    expect(res.status).toBe(200);

    const actions = res.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain("member.invited");
    expect(actions).toContain("workflow.created");

    const invited = res.body.entries.find((e: { action: string }) => e.action === "member.invited");
    expect(invited).toMatchObject({ actorName: "Ada", targetName: "newcomer@example.com" });

    const created = res.body.entries.find((e: { action: string }) => e.action === "workflow.created");
    expect(created).toMatchObject({ actorName: "Ada", targetName: "My Flow", targetType: "workflow" });
  });

  it("records a role change with from/to metadata", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    await join(owner.token, owner.workspaceId, member, "viewer");

    await request(app)
      .patch(`/workspaces/${owner.workspaceId}/members/${member.userId}`)
      .set(...auth(owner.token))
      .send({ role: "editor" });

    const res = await getAudit(owner.token, owner.workspaceId, { action: "member.role_changed" });
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].metadata).toMatchObject({ from: "viewer", to: "editor" });
  });
});

describe("audit log: admin-only access", () => {
  async function workspaceWith(role: "admin" | "editor" | "viewer") {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    await join(owner.token, owner.workspaceId, member, role);
    return { owner, member };
  }

  it("allows an owner and an admin to read the log", async () => {
    const { owner, member } = await workspaceWith("admin");
    expect((await getAudit(owner.token, owner.workspaceId)).status).toBe(200);
    expect((await getAudit(member.token, owner.workspaceId)).status).toBe(200);
  });

  it("forbids an editor and a viewer from reading the log", async () => {
    const editorWs = await workspaceWith("editor");
    expect((await getAudit(editorWs.member.token, editorWs.owner.workspaceId)).status).toBe(403);

    const viewerWs = await workspaceWith("viewer");
    expect((await getAudit(viewerWs.member.token, viewerWs.owner.workspaceId)).status).toBe(403);
  });

  it("forbids a non-member entirely", async () => {
    const owner = await registerUser("Owner");
    const stranger = await registerUser("Stranger");
    expect((await getAudit(stranger.token, owner.workspaceId)).status).toBe(403);
  });
});

describe("audit log: filtering", () => {
  it("filters by actor and by action, and lists distinct actors", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    await join(owner.token, owner.workspaceId, admin, "admin");

    // Owner invites someone; admin invites someone else — two actors acting.
    await invite(owner.token, owner.workspaceId, "a@example.com", "viewer");
    await invite(admin.token, owner.workspaceId, "b@example.com", "viewer");

    const all = await getAudit(owner.token, owner.workspaceId);
    const actorIds = all.body.actors.map((a: { id: string }) => a.id);
    expect(actorIds).toContain(owner.userId);
    expect(actorIds).toContain(admin.userId);

    // Filter to just the admin's actions.
    const byAdmin = await getAudit(owner.token, owner.workspaceId, { actorId: admin.userId });
    expect(byAdmin.body.entries.length).toBeGreaterThan(0);
    expect(byAdmin.body.entries.every((e: { actorId: string }) => e.actorId === admin.userId)).toBe(true);

    // Filter by action: the admin's own invite (to join) plus the two above.
    const invites = await getAudit(owner.token, owner.workspaceId, { action: "member.invited" });
    expect(invites.body.entries.every((e: { action: string }) => e.action === "member.invited")).toBe(true);
    expect(invites.body.entries).toHaveLength(3);
  });

  it("filters by date range", async () => {
    const owner = await registerUser("Owner");
    await invite(owner.token, owner.workspaceId, "x@example.com", "viewer");

    // A window entirely in the future returns nothing.
    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await getAudit(owner.token, owner.workspaceId, { from: future });
    expect(none.body.entries).toHaveLength(0);

    // A window starting in the past includes the entry.
    const past = new Date(Date.now() - 60_000).toISOString();
    const some = await getAudit(owner.token, owner.workspaceId, { from: past });
    expect(some.body.entries.length).toBeGreaterThan(0);
  });
});
