import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { env } from "../config/env";
import { prisma } from "../services/prisma";
import { PrismaRunRecorder } from "../engine/prismaRecorder";
import { createDefaultRegistry } from "../engine/registry";
import { processRun } from "../worker/processRun";
import type { WorkflowDefinition } from "../dag/types";

// The run endpoint now enqueues onto BullMQ; stub that so these tests need only
// Postgres, not Redis. We assert the job *would* be enqueued, then drive the
// worker's processRun directly to simulate the worker draining the queue.
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
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

async function registerUser(name: string, email: string) {
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token as string, userId: res.body.user.id as string, workspaceId: res.body.workspace.id as string };
}

const flowDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "x", type: "action.transform", position: { x: 200, y: 0 }, config: { mappings: { topic: "{{trigger.topic}}" } } },
    { id: "ai", type: "ai.llm", position: { x: 400, y: 0 }, config: { provider: "none", model: "m1", prompt: "Write about {{x.topic}}" } },
    { id: "out", type: "output.response", position: { x: 600, y: 0 }, config: { body: "{{ai.text}}" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "x" },
    { id: "e2", source: "x", target: "ai" },
    { id: "e3", source: "ai", target: "out" },
  ],
};

async function createFlow(token: string, workspaceId: string, definition: object = flowDefinition) {
  const created = await request(app).post("/workflows").set(...authHeader(token)).send({ workspaceId, name: "Runnable" });
  await request(app).put(`/workflows/${created.body.id}`).set(...authHeader(token)).send({ definition });
  return created.body.id as string;
}

/** Simulate the worker consuming the queued job for `runId`. */
async function drainRun(runId: string) {
  return processRun(runId, {
    recorder: new PrismaRunRecorder(prisma),
    loadWorkflow: async (workflowId) => {
      const wf = await prisma.workflow.findUnique({ where: { id: workflowId } });
      // Fallback only — processRun prefers the run's own snapshot. Manual runs snapshot the draft.
      return wf ? { definition: wf.draftDefinition as unknown as WorkflowDefinition, workspaceId: wf.workspaceId } : null;
    },
    registry: createDefaultRegistry(),
    llm: env.llm,
  });
}

describe("POST /workflows/:id/run (enqueue)", () => {
  it("creates a queued run, returns it (202), and enqueues a job", async () => {
    const owner = await registerUser("Ada", "ada-run@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);

    const res = await request(app)
      .post(`/workflows/${workflowId}/run`)
      .set(...authHeader(owner.token))
      .send({ payload: { topic: "comets" } });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.nodeExecutions).toEqual([]);
    expect(res.body.startedAt).toBeNull();
    expect(enqueueSpy).toHaveBeenCalledWith({ runId: res.body.id, workflowId, payload: { topic: "comets" } });
  });

  it("forbids a non-member and 404s an unknown workflow", async () => {
    const owner = await registerUser("Ada", "ada-rbac@example.com");
    const outsider = await registerUser("Eve", "eve-rbac@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);

    const forbidden = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(outsider.token)).send({});
    expect(forbidden.status).toBe(403);

    const missing = await request(app).post("/workflows/does-not-exist/run").set(...authHeader(owner.token)).send({});
    expect(missing.status).toBe(404);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

describe("worker draining a queued run (enqueue -> worker -> completion)", () => {
  it("executes the run end to end and persists success + node executions", async () => {
    const owner = await registerUser("Ada", "ada-drain@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);

    const res = await request(app)
      .post(`/workflows/${workflowId}/run`)
      .set(...authHeader(owner.token))
      .send({ payload: { topic: "tides" } });
    const runId = res.body.id as string;

    const result = await drainRun(runId);
    expect(result.status).toBe("success");

    const stored = await prisma.workflowRun.findUnique({ where: { id: runId }, include: { nodeExecutions: true } });
    expect(stored!.status).toBe("success");
    expect(stored!.startedAt).not.toBeNull();
    expect(stored!.finishedAt).not.toBeNull();
    expect(stored!.nodeExecutions).toHaveLength(4);
    const out = stored!.nodeExecutions.find((n) => n.nodeId === "out");
    expect(out!.output).toEqual({ body: "[stub:m1] Write about tides" });
  });

  it("records a failed run when a node has no executor", async () => {
    const owner = await registerUser("Ada", "ada-fail@example.com");
    const brokenDef = {
      nodes: [
        { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        { id: "z", type: "action.unknown", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "t", target: "z" }],
    };
    const workflowId = await createFlow(owner.token, owner.workspaceId, brokenDef);
    const res = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(owner.token)).send({});

    const result = await drainRun(res.body.id);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/No executor registered/);

    const stored = await prisma.workflowRun.findUnique({ where: { id: res.body.id } });
    expect(stored!.status).toBe("failed");
  });
});

describe("GET /workflows/:id/runs (history)", () => {
  it("lists a workflow's runs, most recent first", async () => {
    const owner = await registerUser("Ada", "ada-hist@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);

    const r1 = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(owner.token)).send({ payload: { topic: "one" } });
    await drainRun(r1.body.id);
    const r2 = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(owner.token)).send({ payload: { topic: "two" } });
    await drainRun(r2.body.id);

    const res = await request(app).get(`/workflows/${workflowId}/runs`).set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ workflowId, status: "success", trigger: "manual" });
    expect(res.body[0].nodeExecutions).toBeUndefined();
    expect(new Date(res.body[0].startedAt).getTime()).toBeGreaterThanOrEqual(new Date(res.body[1].startedAt).getTime());
  });

  it("forbids a non-member from listing runs", async () => {
    const owner = await registerUser("Ada", "ada-histrbac@example.com");
    const outsider = await registerUser("Eve", "eve-histrbac@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);

    const res = await request(app).get(`/workflows/${workflowId}/runs`).set(...authHeader(outsider.token));
    expect(res.status).toBe(403);
  });
});

describe("GET /runs/:id", () => {
  it("returns a single run with its node executions", async () => {
    const owner = await registerUser("Ada", "ada-getrun@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const run = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(owner.token)).send({ payload: { topic: "stars" } });
    await drainRun(run.body.id);

    const res = await request(app).get(`/runs/${run.body.id}`).set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(run.body.id);
    expect(res.body.status).toBe("success");
    expect(res.body.nodeExecutions).toHaveLength(4);
  });

  it("forbids a non-member and 404s an unknown run", async () => {
    const owner = await registerUser("Ada", "ada-getrbac@example.com");
    const outsider = await registerUser("Eve", "eve-getrbac@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const run = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(owner.token)).send({});

    const forbidden = await request(app).get(`/runs/${run.body.id}`).set(...authHeader(outsider.token));
    expect(forbidden.status).toBe(403);

    const missing = await request(app).get("/runs/does-not-exist").set(...authHeader(owner.token));
    expect(missing.status).toBe(404);
  });
});

/** Drains a run with nested sub-workflow execution wired (published-version lookup). */
async function drainRunNested(runId: string) {
  return processRun(runId, {
    recorder: new PrismaRunRecorder(prisma),
    loadWorkflow: async (workflowId) => {
      const wf = await prisma.workflow.findUnique({ where: { id: workflowId } });
      return wf ? { definition: wf.draftDefinition as unknown as WorkflowDefinition, workspaceId: wf.workspaceId } : null;
    },
    loadPublishedWorkflow: async (workflowId) => {
      const wf = await prisma.workflow.findUnique({
        where: { id: workflowId },
        select: { id: true, workspaceId: true, publishedDefinition: true },
      });
      if (!wf || wf.publishedDefinition == null) return null;
      return { workflowId: wf.id, workspaceId: wf.workspaceId, definition: wf.publishedDefinition as unknown as WorkflowDefinition };
    },
    registry: createDefaultRegistry(),
    llm: env.llm,
  });
}

describe("GET /runs/:id — nested sub-workflow lineage", () => {
  it("links a parent run to the nested run its Call Workflow node spawned", async () => {
    const owner = await registerUser("Ada", "ada-nested@example.com");

    // A child workflow that echoes its input, published so it can be called.
    const childDef = {
      nodes: [
        { id: "ct", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        { id: "cout", type: "output.response", position: { x: 200, y: 0 }, config: { body: "child:{{ trigger.topic }}" } },
      ],
      edges: [{ id: "ce", source: "ct", target: "cout" }],
    };
    const childId = await createFlow(owner.token, owner.workspaceId, childDef);
    await request(app).post(`/workflows/${childId}/publish`).set(...authHeader(owner.token)).send({});

    // A parent workflow whose Call Workflow node runs the child as a step.
    const parentDef = {
      nodes: [
        { id: "pt", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        { id: "call", type: "flow.subworkflow", position: { x: 200, y: 0 }, config: { workflowId: childId, input: [{ key: "topic", value: "{{ trigger.topic }}" }] } },
        { id: "pout", type: "output.response", position: { x: 400, y: 0 }, config: { body: "{{ call.output }}" } },
      ],
      edges: [
        { id: "pe1", source: "pt", target: "call" },
        { id: "pe2", source: "call", target: "pout" },
      ],
    };
    const parentId = await createFlow(owner.token, owner.workspaceId, parentDef);

    const run = await request(app).post(`/workflows/${parentId}/run`).set(...authHeader(owner.token)).send({ payload: { topic: "stars" } });
    await drainRunNested(run.body.id);

    // Parent run detail surfaces the nested run, keyed to the calling node.
    const parent = await request(app).get(`/runs/${run.body.id}`).set(...authHeader(owner.token));
    expect(parent.status).toBe(200);
    expect(parent.body.status).toBe("success");
    expect(parent.body.childRuns).toHaveLength(1);
    const child = parent.body.childRuns[0];
    expect(child.parentNodeId).toBe("call");
    expect(child.workflowId).toBe(childId);
    expect(child.status).toBe("success");

    // The child run detail back-references its parent.
    const childRun = await request(app).get(`/runs/${child.id}`).set(...authHeader(owner.token));
    expect(childRun.status).toBe(200);
    expect(childRun.body.parentRun.id).toBe(run.body.id);
    expect(childRun.body.parentRun.workflowId).toBe(parentId);
  });
});
