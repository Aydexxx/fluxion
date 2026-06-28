import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

// Creating/instantiating workflows reconciles cron schedules on save; stub it so
// these tests need only Postgres, not Redis.
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));

const app = createApp();

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

interface Registered {
  token: string;
  userId: string;
  workspaceId: string;
}

let seq = 0;
async function registerUser(name: string): Promise<Registered> {
  seq += 1;
  const res = await request(app)
    .post("/auth/register")
    .send({ name, email: `ut${seq}@example.com`, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, workspaceId: res.body.workspace.id };
}

async function addMember(workspaceId: string, userId: string, role: "admin" | "editor" | "viewer"): Promise<void> {
  await prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
}

/** A workflow graph with a credential binding + pinned sample output to verify stripping. */
const definitionWithSecret = {
  nodes: [
    { id: "n1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    {
      id: "n2",
      type: "action.slack",
      position: { x: 200, y: 0 },
      config: { credentialId: "cred-super-secret", text: "hello {{ n1.value }}" },
      pinnedData: { ok: true, capturedFromLiveRun: "should-not-persist" },
    },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

/** Create a workflow and seed its draft with the above definition. Returns the workflow id. */
async function workflowWithSecret(owner: Registered): Promise<string> {
  const created = await request(app)
    .post("/workflows")
    .set(...authHeader(owner.token))
    .send({ workspaceId: owner.workspaceId, name: "Secretful flow" });
  await request(app)
    .put(`/workflows/${created.body.id}`)
    .set(...authHeader(owner.token))
    .send({ definition: definitionWithSecret });
  return created.body.id;
}

function saveAsTemplate(token: string, body: Record<string, unknown>) {
  return request(app).post("/templates/custom").set(...authHeader(token)).send(body);
}

describe("POST /templates/custom (save as template)", () => {
  it("captures the workflow's current draft definition as a workspace template", async () => {
    const owner = await registerUser("Owner");
    const workflowId = await workflowWithSecret(owner);

    const res = await saveAsTemplate(owner.token, {
      workflowId,
      name: "Onboarding",
      description: "Welcome flow",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "custom",
      name: "Onboarding",
      description: "Welcome flow",
      workspaceId: owner.workspaceId,
      createdByName: "Owner",
    });
    // The graph shape is captured: same node types in first-appearance order.
    expect(res.body.nodeTypes).toEqual(["trigger.manual", "action.slack"]);
    expect(res.body.definition.nodes).toHaveLength(2);
    expect(res.body.definition.edges).toHaveLength(1);
  });

  it("strips credential bindings and pinned data so no secret is stored", async () => {
    const owner = await registerUser("Owner");
    const workflowId = await workflowWithSecret(owner);

    const res = await saveAsTemplate(owner.token, { workflowId, name: "Sanitized" });
    expect(res.status).toBe(201);

    const slack = res.body.definition.nodes.find((n: { id: string }) => n.id === "n2");
    expect(slack.config.credentialId).toBe("");
    expect(slack.pinnedData).toBeUndefined();

    // And nowhere in the serialized template does the secret id survive.
    expect(JSON.stringify(res.body)).not.toContain("cred-super-secret");
    expect(JSON.stringify(res.body)).not.toContain("capturedFromLiveRun");

    // Confirm it's what's actually persisted, too (not just the response).
    const stored = await prisma.workspaceTemplate.findFirst({ where: { workspaceId: owner.workspaceId } });
    expect(JSON.stringify(stored?.definition)).not.toContain("cred-super-secret");
  });

  it("forbids a viewer from creating a template (editors+ only)", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Vic");
    await addMember(owner.workspaceId, viewer.userId, "viewer");
    const workflowId = await workflowWithSecret(owner);

    const res = await saveAsTemplate(viewer.token, { workflowId, name: "Nope" });
    expect(res.status).toBe(403);
  });

  it("lets an editor create a template", async () => {
    const owner = await registerUser("Owner");
    const editor = await registerUser("Ed");
    await addMember(owner.workspaceId, editor.userId, "editor");
    const workflowId = await workflowWithSecret(owner);

    const res = await saveAsTemplate(editor.token, { workflowId, name: "Editor made" });
    expect(res.status).toBe(201);
  });

  it("rejects a non-member of the workflow's workspace", async () => {
    const owner = await registerUser("Owner");
    const outsider = await registerUser("Eve");
    const workflowId = await workflowWithSecret(owner);

    const res = await saveAsTemplate(outsider.token, { workflowId, name: "Stolen" });
    expect(res.status).toBe(403);
  });
});

describe("GET /templates/custom", () => {
  it("lists only the requested workspace's templates", async () => {
    const owner = await registerUser("Owner");
    const workflowId = await workflowWithSecret(owner);
    await saveAsTemplate(owner.token, { workflowId, name: "Mine" });

    const res = await request(app)
      .get("/templates/custom")
      .query({ workspaceId: owner.workspaceId })
      .set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: "Mine", kind: "custom" });

    // An outsider cannot list this workspace's templates.
    const outsider = await registerUser("Eve");
    const denied = await request(app)
      .get("/templates/custom")
      .query({ workspaceId: owner.workspaceId })
      .set(...authHeader(outsider.token));
    expect(denied.status).toBe(403);
  });
});

describe("POST /templates/custom/:id/instantiate", () => {
  it("creates a working workflow any member can re-save without warnings", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Vic");
    await addMember(owner.workspaceId, viewer.userId, "viewer");
    const workflowId = await workflowWithSecret(owner);
    const template = await saveAsTemplate(owner.token, { workflowId, name: "Reusable" });

    // A viewer (any member) may use a template.
    const res = await request(app)
      .post(`/templates/custom/${template.body.id}/instantiate`)
      .set(...authHeader(viewer.token))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ workspaceId: owner.workspaceId, name: "Reusable", isActive: true });
    expect(res.body.webhookToken).toEqual(expect.any(String));
    expect(res.body.definition.nodes).toHaveLength(2);

    // It's a real, independently-listable workflow whose definition re-saves cleanly.
    const saved = await request(app)
      .put(`/workflows/${res.body.id}`)
      .set(...authHeader(owner.token))
      .send({ definition: res.body.definition });
    expect(saved.status).toBe(200);
    expect(saved.body.warnings).toEqual([]);
  });

  it("honours a name override", async () => {
    const owner = await registerUser("Owner");
    const workflowId = await workflowWithSecret(owner);
    const template = await saveAsTemplate(owner.token, { workflowId, name: "Base" });

    const res = await request(app)
      .post(`/templates/custom/${template.body.id}/instantiate`)
      .set(...authHeader(owner.token))
      .send({ name: "Renamed copy" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Renamed copy");
  });
});

describe("PATCH / DELETE /templates/custom/:id", () => {
  it("renames and re-describes a template (editor+)", async () => {
    const owner = await registerUser("Owner");
    const workflowId = await workflowWithSecret(owner);
    const template = await saveAsTemplate(owner.token, { workflowId, name: "Old", description: "old" });

    const res = await request(app)
      .patch(`/templates/custom/${template.body.id}`)
      .set(...authHeader(owner.token))
      .send({ name: "New name", description: "new desc" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "New name", description: "new desc" });
  });

  it("forbids a viewer from deleting, allows an editor", async () => {
    const owner = await registerUser("Owner");
    const viewer = await registerUser("Vic");
    const editor = await registerUser("Ed");
    await addMember(owner.workspaceId, viewer.userId, "viewer");
    await addMember(owner.workspaceId, editor.userId, "editor");
    const workflowId = await workflowWithSecret(owner);
    const template = await saveAsTemplate(owner.token, { workflowId, name: "Doomed" });

    const denied = await request(app)
      .delete(`/templates/custom/${template.body.id}`)
      .set(...authHeader(viewer.token));
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .delete(`/templates/custom/${template.body.id}`)
      .set(...authHeader(editor.token));
    expect(ok.status).toBe(204);

    const list = await request(app)
      .get("/templates/custom")
      .query({ workspaceId: owner.workspaceId })
      .set(...authHeader(owner.token));
    expect(list.body).toHaveLength(0);
  });
});
