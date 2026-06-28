import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";
import type { ApiScope } from "../services/apiKeys";

// The public trigger endpoint enqueues onto BullMQ; stub it so the suite needs
// only Postgres, not Redis. We assert a run row is created, not that it executes.
const { enqueueSpy } = vi.hoisted(() => ({ enqueueSpy: vi.fn(async () => {}) }));
vi.mock("../queue/workflowQueue", () => ({
  enqueueWorkflowRun: enqueueSpy,
  WORKFLOW_RUNS_QUEUE: "workflow-runs",
}));
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));

const app = createApp();

beforeEach(async () => {
  enqueueSpy.mockClear();
  await prisma.apiKey.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}
function apiKeyHeader(key: string): [string, string] {
  return ["X-API-Key", key];
}

async function registerUser(email: string) {
  const res = await request(app).post("/auth/register").send({ name: "User", email, password: "Password123!" });
  return { token: res.body.token as string, workspaceId: res.body.workspace.id as string };
}

const simpleDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "out", type: "output.response", position: { x: 200, y: 0 }, config: { body: "hi {{ trigger.name }}" } },
  ],
  edges: [{ id: "e", source: "t", target: "out" }],
};

/** Creates a workflow and publishes it (so the API can trigger it). Returns its id. */
async function createPublishedWorkflow(token: string, workspaceId: string): Promise<string> {
  const created = await request(app).post("/workflows").set(...auth(token)).send({ workspaceId, name: "API flow" });
  const id = created.body.id as string;
  await request(app).put(`/workflows/${id}`).set(...auth(token)).send({ definition: simpleDefinition });
  await request(app).post(`/workflows/${id}/publish`).set(...auth(token)).send({});
  return id;
}

/** Mints an API key with the given scopes via the session management API. */
async function mintKey(token: string, workspaceId: string, scopes: ApiScope[]): Promise<string> {
  const res = await request(app)
    .post(`/workspaces/${workspaceId}/api-keys`)
    .set(...auth(token))
    .send({ name: "test-key", scopes });
  return res.body.key as string;
}

describe("/api/v1 — key authentication", () => {
  it("rejects a request with no API key", async () => {
    const res = await request(app).get("/api/v1/workflows");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown key", async () => {
    const res = await request(app).get("/api/v1/workflows").set(...apiKeyHeader("flux_not_a_real_key"));
    expect(res.status).toBe(401);
  });

  it("rejects a revoked key", async () => {
    const owner = await registerUser("owner@api.com");
    const created = await request(app)
      .post(`/workspaces/${owner.workspaceId}/api-keys`)
      .set(...auth(owner.token))
      .send({ name: "k", scopes: ["workflows:read"] });
    await request(app).delete(`/workspaces/${owner.workspaceId}/api-keys/${created.body.id}`).set(...auth(owner.token));

    const res = await request(app).get("/api/v1/workflows").set(...apiKeyHeader(created.body.key));
    expect(res.status).toBe(401);
  });

  it("records last-used after an authenticated request", async () => {
    const owner = await registerUser("owner-lu@api.com");
    const key = await mintKey(owner.token, owner.workspaceId, ["workflows:read"]);
    await request(app).get("/api/v1/workflows").set(...apiKeyHeader(key));

    const list = await request(app).get(`/workspaces/${owner.workspaceId}/api-keys`).set(...auth(owner.token));
    expect(list.body[0].lastUsedAt).not.toBeNull();
  });
});

describe("/api/v1 — scope enforcement", () => {
  it("forbids triggering a run with a read-only key", async () => {
    const owner = await registerUser("owner-ro@api.com");
    const workflowId = await createPublishedWorkflow(owner.token, owner.workspaceId);
    const readKey = await mintKey(owner.token, owner.workspaceId, ["workflows:read"]);

    const res = await request(app).post(`/api/v1/workflows/${workflowId}/runs`).set(...apiKeyHeader(readKey)).send({});
    expect(res.status).toBe(403);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("forbids reading workflows with a run-only key", async () => {
    const owner = await registerUser("owner-run@api.com");
    const runKey = await mintKey(owner.token, owner.workspaceId, ["workflows:run"]);

    const res = await request(app).get("/api/v1/workflows").set(...apiKeyHeader(runKey));
    expect(res.status).toBe(403);
  });
});

describe("/api/v1 — workflows + runs", () => {
  it("lists and gets workflows scoped to the key's workspace", async () => {
    const owner = await registerUser("owner-wf@api.com");
    const workflowId = await createPublishedWorkflow(owner.token, owner.workspaceId);
    const key = await mintKey(owner.token, owner.workspaceId, ["workflows:read"]);

    const list = await request(app).get("/api/v1/workflows").set(...apiKeyHeader(key));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: workflowId, published: true });

    const one = await request(app).get(`/api/v1/workflows/${workflowId}`).set(...apiKeyHeader(key));
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(workflowId);
  });

  it("isolates tenants — a key can't read another workspace's workflow", async () => {
    const a = await registerUser("tenant-a@api.com");
    const b = await registerUser("tenant-b@api.com");
    const bWorkflow = await createPublishedWorkflow(b.token, b.workspaceId);
    const aKey = await mintKey(a.token, a.workspaceId, ["workflows:read"]);

    const res = await request(app).get(`/api/v1/workflows/${bWorkflow}`).set(...apiKeyHeader(aKey));
    expect(res.status).toBe(404);
  });

  it("triggers a run via the API and exposes it through the runs endpoints", async () => {
    const owner = await registerUser("owner-trigger@api.com");
    const workflowId = await createPublishedWorkflow(owner.token, owner.workspaceId);
    const key = await mintKey(owner.token, owner.workspaceId, ["workflows:read", "workflows:run"]);

    const triggered = await request(app)
      .post(`/api/v1/workflows/${workflowId}/runs`)
      .set(...apiKeyHeader(key))
      .send({ payload: { name: "Ada" } });

    expect(triggered.status).toBe(202);
    expect(triggered.body.status).toBe("queued");
    expect(triggered.body.trigger).toBe("api");
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const runId = triggered.body.id as string;

    const list = await request(app).get("/api/v1/runs").set(...apiKeyHeader(key));
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: string }) => r.id)).toContain(runId);

    const detail = await request(app).get(`/api/v1/runs/${runId}`).set(...apiKeyHeader(key));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: runId, workflowId, trigger: "api" });
    expect(detail.body).toHaveProperty("output");
  });

  it("404s triggering an unpublished workflow", async () => {
    const owner = await registerUser("owner-unpub@api.com");
    const created = await request(app).post("/workflows").set(...auth(owner.token)).send({ workspaceId: owner.workspaceId, name: "draft only" });
    const key = await mintKey(owner.token, owner.workspaceId, ["workflows:run"]);

    const res = await request(app).post(`/api/v1/workflows/${created.body.id}/runs`).set(...apiKeyHeader(key)).send({});
    expect(res.status).toBe(400);
  });
});
