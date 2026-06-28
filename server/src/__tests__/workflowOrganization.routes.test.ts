import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

// Workflow create/update reconcile cron schedules; stub so these tests need only Postgres.
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
  const email = `org${emailSeq}@example.com`;
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, email, workspaceId: res.body.workspace.id };
}

function createWorkflow(token: string, workspaceId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/workflows")
    .set(...auth(token))
    .send({ workspaceId, name: "WF", ...body });
}

function updateWorkflow(token: string, id: string, body: Record<string, unknown>) {
  return request(app)
    .put(`/workflows/${id}`)
    .set(...auth(token))
    .send(body);
}

function listWorkflows(token: string, workspaceId: string, query: Record<string, string> = {}) {
  return request(app).get("/workflows").query({ workspaceId, ...query }).set(...auth(token));
}

function names(res: { body: { name: string }[] }): string[] {
  return res.body.map((w) => w.name);
}

describe("tags: assignment", () => {
  it("assigns multiple tags to a workflow at creation", async () => {
    const owner = await registerUser("Owner");
    const wf = await createWorkflow(owner.token, owner.workspaceId, { tags: ["Marketing", "urgent"] });
    expect(wf.status).toBe(201);
    expect(wf.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(["marketing", "urgent"]);
  });

  it("normalizes tag names (trim + lowercase) and de-duplicates", async () => {
    const owner = await registerUser("Owner");
    const wf = await createWorkflow(owner.token, owner.workspaceId);

    const res = await updateWorkflow(owner.token, wf.body.id, { tags: ["  Ops ", "ops", "OPS"] });
    expect(res.body.tags).toHaveLength(1);
    expect(res.body.tags[0].name).toBe("ops");
  });

  it("reuses an existing workspace tag rather than creating a duplicate", async () => {
    const owner = await registerUser("Owner");
    const a = await createWorkflow(owner.token, owner.workspaceId, { tags: ["shared"] });
    const b = await createWorkflow(owner.token, owner.workspaceId, { tags: ["shared"] });

    expect(a.body.tags[0].id).toBe(b.body.tags[0].id);

    const tags = await request(app).get(`/workspaces/${owner.workspaceId}/tags`).set(...auth(owner.token));
    expect(tags.body).toHaveLength(1);
  });

  it("replaces the full tag set on update, and prunes orphaned tags", async () => {
    const owner = await registerUser("Owner");
    const wf = await createWorkflow(owner.token, owner.workspaceId, { tags: ["alpha", "beta"] });

    const res = await updateWorkflow(owner.token, wf.body.id, { tags: ["beta", "gamma"] });
    expect(res.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(["beta", "gamma"]);

    // "alpha" is no longer used by anything, so it should be pruned from the workspace.
    const tags = await request(app).get(`/workspaces/${owner.workspaceId}/tags`).set(...auth(owner.token));
    expect(tags.body.map((t: { name: string }) => t.name).sort()).toEqual(["beta", "gamma"]);
  });

  it("clears all tags when given an empty array", async () => {
    const owner = await registerUser("Owner");
    const wf = await createWorkflow(owner.token, owner.workspaceId, { tags: ["temp"] });

    const res = await updateWorkflow(owner.token, wf.body.id, { tags: [] });
    expect(res.body.tags).toEqual([]);
  });

  it("forbids a viewer from tagging a workflow", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Viewer");
    await request(app)
      .post(`/workspaces/${owner.workspaceId}/invites`)
      .set(...auth(owner.token))
      .send({ email: viewer.email, role: "viewer" });
    const inviteId = (await request(app).get("/invites").set(...auth(viewer.token))).body[0].id;
    await request(app).post(`/invites/${inviteId}/accept`).set(...auth(viewer.token));

    const wf = await createWorkflow(owner.token, owner.workspaceId);
    const res = await updateWorkflow(viewer.token, wf.body.id, { tags: ["nope"] });
    expect(res.status).toBe(403);
  });
});

describe("workflows list: filter by tag", () => {
  it("filters to workflows carrying a given tag", async () => {
    const owner = await registerUser("Owner");
    const tagged = await createWorkflow(owner.token, owner.workspaceId, { name: "Tagged", tags: ["finance"] });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Plain" });

    const tagId = tagged.body.tags[0].id;
    const res = await listWorkflows(owner.token, owner.workspaceId, { tagId });
    expect(names(res)).toEqual(["Tagged"]);
  });
});

describe("workflows list: search", () => {
  it("matches by name or description, case-insensitively", async () => {
    const owner = await registerUser("Owner");
    await createWorkflow(owner.token, owner.workspaceId, { name: "Send Invoices" });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Other", description: "handles INVOICE retries" });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Unrelated" });

    const res = await listWorkflows(owner.token, owner.workspaceId, { search: "invoice" });
    expect(names(res).sort()).toEqual(["Other", "Send Invoices"]);
  });
});

describe("workflows list: sort", () => {
  it("sorts by name ascending/descending", async () => {
    const owner = await registerUser("Owner");
    await createWorkflow(owner.token, owner.workspaceId, { name: "Charlie" });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Alpha" });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Bravo" });

    const asc = await listWorkflows(owner.token, owner.workspaceId, { sortBy: "name", sortDir: "asc" });
    expect(names(asc)).toEqual(["Alpha", "Bravo", "Charlie"]);

    const desc = await listWorkflows(owner.token, owner.workspaceId, { sortBy: "name", sortDir: "desc" });
    expect(names(desc)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("sorts by updatedAt descending by default, bumping on edit", async () => {
    const owner = await registerUser("Owner");
    const first = await createWorkflow(owner.token, owner.workspaceId, { name: "First" });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Second" });

    // Touch "First" so it becomes the most recently updated.
    await updateWorkflow(owner.token, first.body.id, { description: "bumped" });

    const res = await listWorkflows(owner.token, owner.workspaceId);
    expect(names(res)).toEqual(["First", "Second"]);
  });
});

describe("workflows list: filter by active status", () => {
  it("filters to active or inactive workflows", async () => {
    const owner = await registerUser("Owner");
    const active = await createWorkflow(owner.token, owner.workspaceId, { name: "Active one" });
    const toDisable = await createWorkflow(owner.token, owner.workspaceId, { name: "Disabled one" });
    await updateWorkflow(owner.token, toDisable.body.id, { isActive: false });
    void active;

    const activeOnly = await listWorkflows(owner.token, owner.workspaceId, { isActive: "true" });
    expect(names(activeOnly)).toEqual(["Active one"]);

    const inactiveOnly = await listWorkflows(owner.token, owner.workspaceId, { isActive: "false" });
    expect(names(inactiveOnly)).toEqual(["Disabled one"]);
  });
});

describe("workflows list: combined filters", () => {
  it("combines folder, tag, status, and search together", async () => {
    const owner = await registerUser("Owner");
    const folder = await request(app)
      .post(`/workspaces/${owner.workspaceId}/folders`)
      .set(...auth(owner.token))
      .send({ name: "Billing" });

    const match = await createWorkflow(owner.token, owner.workspaceId, {
      name: "Invoice sync",
      folderId: folder.body.id,
      tags: ["finance"],
    });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Invoice backup", tags: ["finance"] }); // wrong folder
    await createWorkflow(owner.token, owner.workspaceId, { name: "Invoice archive", folderId: folder.body.id }); // wrong tag

    const res = await listWorkflows(owner.token, owner.workspaceId, {
      folderId: folder.body.id,
      tagId: match.body.tags[0].id,
      search: "invoice",
      isActive: "true",
    });
    expect(names(res)).toEqual(["Invoice sync"]);
  });
});
