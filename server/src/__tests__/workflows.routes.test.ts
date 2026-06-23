import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

// Workflow create/update/delete reconcile cron schedules; stub that so these
// tests need only Postgres, not Redis.
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));

const app = createApp();

beforeEach(async () => {
  // Workspace.ownerId has no cascade from User, so child rows must go first.
  // Workflow/WorkflowRun/NodeExecution/WorkspaceMember all cascade from Workspace.
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

interface Registered {
  token: string;
  userId: string;
  workspaceId: string;
}

async function registerUser(name: string, email: string): Promise<Registered> {
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, workspaceId: res.body.workspace.id };
}

function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

async function addMember(workspaceId: string, userId: string, role: "owner" | "admin" | "member"): Promise<void> {
  await prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
}

async function createWorkflow(token: string, workspaceId: string, name = "My Workflow") {
  return request(app).post("/workflows").set(...authHeader(token)).send({ workspaceId, name });
}

const triggerActionDefinition = {
  nodes: [
    { id: "n1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "n2", type: "action.http", position: { x: 100, y: 0 }, config: { url: "https://example.com" } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

describe("POST /workflows", () => {
  it("creates a workflow with an empty definition", async () => {
    const owner = await registerUser("Ada Lovelace", "ada@example.com");

    const res = await request(app)
      .post("/workflows")
      .set(...authHeader(owner.token))
      .send({ workspaceId: owner.workspaceId, name: "My Workflow", description: "desc" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId: owner.workspaceId,
      name: "My Workflow",
      description: "desc",
      isActive: true,
      definition: { nodes: [], edges: [] },
    });
  });

  it("rejects a user who is not a member of the workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "ada2@example.com");
    const outsider = await registerUser("Eve", "eve@example.com");

    const res = await request(app)
      .post("/workflows")
      .set(...authHeader(outsider.token))
      .send({ workspaceId: owner.workspaceId, name: "Intrusion" });

    expect(res.status).toBe(403);
  });

  it("rejects an invalid body", async () => {
    const owner = await registerUser("Ada Lovelace", "ada3@example.com");

    const res = await request(app)
      .post("/workflows")
      .set(...authHeader(owner.token))
      .send({ workspaceId: owner.workspaceId, name: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /workflows", () => {
  it("lists only workflows in the requested workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "ada4@example.com");
    const other = await registerUser("Grace", "grace4@example.com");
    await createWorkflow(owner.token, owner.workspaceId, "Workflow A");
    await createWorkflow(owner.token, owner.workspaceId, "Workflow B");
    await createWorkflow(other.token, other.workspaceId, "Workflow C");

    const res = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId })
      .set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((w: { name: string }) => w.name).sort()).toEqual(["Workflow A", "Workflow B"]);
  });

  it("rejects a user who is not a member of the workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "ada5@example.com");
    const outsider = await registerUser("Eve", "eve5@example.com");

    const res = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId })
      .set(...authHeader(outsider.token));

    expect(res.status).toBe(403);
  });

  it("requires the workspaceId query parameter", async () => {
    const owner = await registerUser("Ada Lovelace", "ada6@example.com");

    const res = await request(app).get("/workflows").set(...authHeader(owner.token));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /workflows/:id", () => {
  it("returns the full workflow including its definition", async () => {
    const owner = await registerUser("Ada Lovelace", "ada7@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .get(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, name: "Workflow A", definition: { nodes: [], edges: [] } });
  });

  it("returns 404 for an unknown workflow", async () => {
    const owner = await registerUser("Ada Lovelace", "ada8@example.com");

    const res = await request(app)
      .get("/workflows/does-not-exist")
      .set(...authHeader(owner.token));

    expect(res.status).toBe(404);
  });

  it("rejects a user who is not a member of the owning workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "ada9@example.com");
    const outsider = await registerUser("Eve", "eve9@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .get(`/workflows/${created.body.id}`)
      .set(...authHeader(outsider.token));

    expect(res.status).toBe(403);
  });
});

describe("PUT /workflows/:id", () => {
  it("updates name, description, and isActive", async () => {
    const owner = await registerUser("Ada Lovelace", "ada10@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token))
      .send({ name: "Renamed", description: "new description", isActive: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", description: "new description", isActive: false });
  });

  it("accepts a valid, fully-connected definition", async () => {
    const owner = await registerUser("Ada Lovelace", "ada11@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token))
      .send({ definition: triggerActionDefinition });

    expect(res.status).toBe(200);
    expect(res.body.definition).toEqual(triggerActionDefinition);
    expect(res.body.warnings).toEqual([]);
  });

  it("rejects a cyclic definition", async () => {
    const owner = await registerUser("Ada Lovelace", "ada12@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");
    const cyclic = {
      nodes: [
        { id: "n1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        { id: "n2", type: "action.http", position: { x: 100, y: 0 }, config: {} },
        { id: "n3", type: "action.transform", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
        { id: "e3", source: "n3", target: "n2" },
      ],
    };

    const res = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token))
      .send({ definition: cyclic });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/cycle/i);
  });

  it("rejects a definition with an edge referencing a missing node", async () => {
    const owner = await registerUser("Ada Lovelace", "ada13@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");
    const broken = {
      nodes: [{ id: "n1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "n1", target: "missing" }],
    };

    const res = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token))
      .send({ definition: broken });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/unknown target node "missing"/);
  });

  it("saves successfully but reports a warning for a disconnected action node", async () => {
    const owner = await registerUser("Ada Lovelace", "ada14@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");
    const withOrphan = {
      nodes: [
        ...triggerActionDefinition.nodes,
        { id: "orphan", type: "action.transform", position: { x: 0, y: 200 }, config: {} },
      ],
      edges: triggerActionDefinition.edges,
    };

    const res = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token))
      .send({ definition: withOrphan });

    expect(res.status).toBe(200);
    expect(res.body.definition).toEqual(withOrphan);
    expect(res.body.warnings).toContain('Node "orphan" (action.transform) is disconnected from the workflow graph');
  });

  it("rejects a user who is not a member of the owning workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "ada15@example.com");
    const outsider = await registerUser("Eve", "eve15@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(outsider.token))
      .send({ name: "Hijacked" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /workflows/:id (RBAC enforcement)", () => {
  it("allows the owner to delete a workflow", async () => {
    const owner = await registerUser("Ada Lovelace", "ada16@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .delete(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token));
    expect(res.status).toBe(204);

    const getRes = await request(app)
      .get(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token));
    expect(getRes.status).toBe(404);
  });

  it("allows an admin member to delete a workflow", async () => {
    const owner = await registerUser("Ada Lovelace", "ada17@example.com");
    const admin = await registerUser("Admin Annie", "admin17@example.com");
    await addMember(owner.workspaceId, admin.userId, "admin");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .delete(`/workflows/${created.body.id}`)
      .set(...authHeader(admin.token));

    expect(res.status).toBe(204);
  });

  it("forbids a plain member from deleting a workflow", async () => {
    const owner = await registerUser("Ada Lovelace", "ada18@example.com");
    const member = await registerUser("Mira Member", "member18@example.com");
    await addMember(owner.workspaceId, member.userId, "member");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .delete(`/workflows/${created.body.id}`)
      .set(...authHeader(member.token));

    expect(res.status).toBe(403);

    const getRes = await request(app)
      .get(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token));
    expect(getRes.status).toBe(200);
  });

  it("forbids a user who is not a member of the workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "ada19@example.com");
    const outsider = await registerUser("Eve", "eve19@example.com");
    const created = await createWorkflow(owner.token, owner.workspaceId, "Workflow A");

    const res = await request(app)
      .delete(`/workflows/${created.body.id}`)
      .set(...authHeader(outsider.token));

    expect(res.status).toBe(403);
  });
});
