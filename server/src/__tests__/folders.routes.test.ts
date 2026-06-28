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
  const email = `folder${emailSeq}@example.com`;
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

function createFolder(token: string, workspaceId: string, name: string) {
  return request(app).post(`/workspaces/${workspaceId}/folders`).set(...auth(token)).send({ name });
}

function createWorkflow(token: string, workspaceId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/workflows")
    .set(...auth(token))
    .send({ workspaceId, name: "WF", ...body });
}

describe("folders: CRUD", () => {
  it("creates, lists, renames, and deletes a folder", async () => {
    const owner = await registerUser("Owner");

    const created = await createFolder(owner.token, owner.workspaceId, "Marketing");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Marketing", workflowCount: 0 });

    const list = await request(app).get(`/workspaces/${owner.workspaceId}/folders`).set(...auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const renamed = await request(app)
      .patch(`/workspaces/${owner.workspaceId}/folders/${created.body.id}`)
      .set(...auth(owner.token))
      .send({ name: "Growth" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Growth");

    const deleted = await request(app)
      .delete(`/workspaces/${owner.workspaceId}/folders/${created.body.id}`)
      .set(...auth(owner.token));
    expect(deleted.status).toBe(204);

    const afterDelete = await request(app).get(`/workspaces/${owner.workspaceId}/folders`).set(...auth(owner.token));
    expect(afterDelete.body).toHaveLength(0);
  });

  it("reports an accurate workflow count per folder", async () => {
    const owner = await registerUser("Owner");
    const folder = await createFolder(owner.token, owner.workspaceId, "Ops");
    await createWorkflow(owner.token, owner.workspaceId, { folderId: folder.body.id });
    await createWorkflow(owner.token, owner.workspaceId, { folderId: folder.body.id });
    await createWorkflow(owner.token, owner.workspaceId); // unfiled

    const list = await request(app).get(`/workspaces/${owner.workspaceId}/folders`).set(...auth(owner.token));
    expect(list.body[0]).toMatchObject({ name: "Ops", workflowCount: 2 });
  });

  it("forbids a viewer from creating, renaming, or deleting folders, but allows listing", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Viewer");
    await join(owner.token, owner.workspaceId, viewer, "viewer");
    const folder = await createFolder(owner.token, owner.workspaceId, "Locked");

    expect((await createFolder(viewer.token, owner.workspaceId, "Nope")).status).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/workspaces/${owner.workspaceId}/folders/${folder.body.id}`)
          .set(...auth(viewer.token))
          .send({ name: "Nope" })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/workspaces/${owner.workspaceId}/folders/${folder.body.id}`).set(...auth(viewer.token)))
        .status,
    ).toBe(403);

    expect((await request(app).get(`/workspaces/${owner.workspaceId}/folders`).set(...auth(viewer.token))).status).toBe(
      200,
    );
  });

  it("404s renaming/deleting a folder that belongs to another workspace", async () => {
    const owner = await registerUser("Owner");
    const other = await registerUser("Other");
    const folder = await createFolder(owner.token, owner.workspaceId, "Mine");

    const res = await request(app)
      .patch(`/workspaces/${other.workspaceId}/folders/${folder.body.id}`)
      .set(...auth(other.token))
      .send({ name: "Steal" });
    expect(res.status).toBe(404);
  });

  it("rejects an empty folder name", async () => {
    const owner = await registerUser("Owner");
    const res = await createFolder(owner.token, owner.workspaceId, "  ");
    expect(res.status).toBe(400);
  });
});

describe("folders: moving workflows in/out", () => {
  it("moves a workflow into a folder, between folders, and back out via PUT /workflows/:id", async () => {
    const owner = await registerUser("Owner");
    const a = await createFolder(owner.token, owner.workspaceId, "A");
    const b = await createFolder(owner.token, owner.workspaceId, "B");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    expect(wf.body.folder).toBeNull();

    const intoA = await request(app)
      .put(`/workflows/${wf.body.id}`)
      .set(...auth(owner.token))
      .send({ folderId: a.body.id });
    expect(intoA.body.folder).toMatchObject({ id: a.body.id, name: "A" });

    const intoB = await request(app)
      .put(`/workflows/${wf.body.id}`)
      .set(...auth(owner.token))
      .send({ folderId: b.body.id });
    expect(intoB.body.folder).toMatchObject({ id: b.body.id, name: "B" });

    const out = await request(app)
      .put(`/workflows/${wf.body.id}`)
      .set(...auth(owner.token))
      .send({ folderId: null });
    expect(out.body.folder).toBeNull();
  });

  it("un-files workflows automatically when their folder is deleted", async () => {
    const owner = await registerUser("Owner");
    const folder = await createFolder(owner.token, owner.workspaceId, "Temp");
    const wf = await createWorkflow(owner.token, owner.workspaceId, { folderId: folder.body.id });

    await request(app).delete(`/workspaces/${owner.workspaceId}/folders/${folder.body.id}`).set(...auth(owner.token));

    const after = await request(app).get(`/workflows/${wf.body.id}`).set(...auth(owner.token));
    expect(after.body.folder).toBeNull();
  });

  it("rejects moving a workflow into a folder from another workspace", async () => {
    const owner = await registerUser("Owner");
    const other = await registerUser("Other");
    const otherFolder = await createFolder(other.token, other.workspaceId, "NotYours");
    const wf = await createWorkflow(owner.token, owner.workspaceId);

    const res = await request(app)
      .put(`/workflows/${wf.body.id}`)
      .set(...auth(owner.token))
      .send({ folderId: otherFolder.body.id });
    expect(res.status).toBe(404);
  });

  it("filters the workflow list by folder, including the unfiled (\"none\") bucket", async () => {
    const owner = await registerUser("Owner");
    const folder = await createFolder(owner.token, owner.workspaceId, "Filed");
    await createWorkflow(owner.token, owner.workspaceId, { folderId: folder.body.id, name: "In folder" });
    await createWorkflow(owner.token, owner.workspaceId, { name: "Unfiled" });

    const inFolder = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId, folderId: folder.body.id })
      .set(...auth(owner.token));
    expect(inFolder.body.map((w: { name: string }) => w.name)).toEqual(["In folder"]);

    const unfiled = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId, folderId: "none" })
      .set(...auth(owner.token));
    expect(unfiled.body.map((w: { name: string }) => w.name)).toEqual(["Unfiled"]);
  });
});
