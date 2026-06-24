import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { env } from "../config/env";
import { prisma } from "../services/prisma";
import { PrismaRunRecorder } from "../engine/prismaRecorder";
import { createDefaultRegistry } from "../engine/registry";
import { processRun } from "../worker/processRun";
import type { WorkflowDefinition } from "../dag/types";

// Hermetic: stub the queue + scheduler so these tests need only Postgres.
const { enqueueSpy } = vi.hoisted(() => ({ enqueueSpy: vi.fn(async () => {}) }));
vi.mock("../queue/workflowQueue", () => ({ enqueueWorkflowRun: enqueueSpy, WORKFLOW_RUNS_QUEUE: "workflow-runs" }));
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

async function registerUser(email: string) {
  const res = await request(app).post("/auth/register").send({ name: "Ada", email, password: "Password123!" });
  return { token: res.body.token as string, workspaceId: res.body.workspace.id as string };
}

const okDef = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "out", type: "output.response", position: { x: 200, y: 0 }, config: { body: "{{ trigger.topic }}" } },
  ],
  edges: [{ id: "e1", source: "t", target: "out" }],
};

const failDef = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "z", type: "action.unknown", position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [{ id: "e1", source: "t", target: "z" }],
};

async function createFlow(token: string, workspaceId: string, definition: object = okDef) {
  const created = await request(app).post("/workflows").set(...authHeader(token)).send({ workspaceId, name: "Flow" });
  await request(app).put(`/workflows/${created.body.id}`).set(...authHeader(token)).send({ definition });
  return created.body.id as string;
}

async function startRun(token: string, workflowId: string, payload: unknown = {}) {
  const res = await request(app).post(`/workflows/${workflowId}/run`).set(...authHeader(token)).send({ payload });
  return res.body.id as string;
}

async function drain(runId: string) {
  return processRun(runId, {
    recorder: new PrismaRunRecorder(prisma),
    loadWorkflow: async (workflowId) => {
      const wf = await prisma.workflow.findUnique({ where: { id: workflowId } });
      return wf ? { definition: wf.definition as unknown as WorkflowDefinition, workspaceId: wf.workspaceId } : null;
    },
    registry: createDefaultRegistry(),
    llm: env.llm,
  });
}

describe("POST /runs/:id/replay", () => {
  it("enqueues a fresh run with the same payload, linked to the origin", async () => {
    const owner = await registerUser("replay@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const originId = await startRun(owner.token, workflowId, { topic: "comets" });
    await drain(originId);
    enqueueSpy.mockClear();

    const res = await request(app).post(`/runs/${originId}/replay`).set(...authHeader(owner.token));

    expect(res.status).toBe(202);
    expect(res.body.id).not.toBe(originId);
    expect(res.body.replayOfId).toBe(originId);
    expect(res.body.payload).toEqual({ topic: "comets" });
    expect(res.body.status).toBe("queued");
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({ runId: res.body.id, workflowId }));
  });

  it("forbids a non-member and 404s an unknown run", async () => {
    const owner = await registerUser("replayowner@example.com");
    const outsider = await registerUser("replayoutsider@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const runId = await startRun(owner.token, workflowId);

    expect((await request(app).post(`/runs/${runId}/replay`).set(...authHeader(outsider.token))).status).toBe(403);
    expect((await request(app).post(`/runs/does-not-exist/replay`).set(...authHeader(owner.token))).status).toBe(404);
  });
});

describe("GET /runs (workspace runs dashboard)", () => {
  it("lists runs across the workspace with workflow names + lineage, newest first", async () => {
    const owner = await registerUser("dash@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const r1 = await startRun(owner.token, workflowId, { topic: "one" });
    await drain(r1);
    const r2 = await startRun(owner.token, workflowId, { topic: "two" });
    await drain(r2);

    const res = await request(app).get("/runs").query({ workspaceId: owner.workspaceId }).set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ workflowName: "Flow", status: "success" });
    expect(res.body[0]).toHaveProperty("replayOfId");
  });

  it("filters by status", async () => {
    const owner = await registerUser("dashfilter@example.com");
    const okFlow = await createFlow(owner.token, owner.workspaceId, okDef);
    const badFlow = await createFlow(owner.token, owner.workspaceId, failDef);
    await drain(await startRun(owner.token, okFlow));
    await drain(await startRun(owner.token, badFlow));

    const failed = await request(app).get("/runs").query({ workspaceId: owner.workspaceId, status: "failed" }).set(...authHeader(owner.token));
    expect(failed.body).toHaveLength(1);
    expect(failed.body[0].status).toBe("failed");
  });

  it("rejects a missing workspaceId (validation) and a bad status", async () => {
    const owner = await registerUser("dashvalid@example.com");
    expect((await request(app).get("/runs").set(...authHeader(owner.token))).status).toBe(400);
    expect(
      (await request(app).get("/runs").query({ workspaceId: owner.workspaceId, status: "nope" }).set(...authHeader(owner.token))).status,
    ).toBe(400);
  });
});

describe("GET /analytics", () => {
  it("aggregates success/failure counts and most-failing workflows", async () => {
    const owner = await registerUser("analytics@example.com");
    const okFlow = await createFlow(owner.token, owner.workspaceId, okDef);
    const badFlow = await createFlow(owner.token, owner.workspaceId, failDef);
    await drain(await startRun(owner.token, okFlow));
    await drain(await startRun(owner.token, badFlow));
    await drain(await startRun(owner.token, badFlow));

    const res = await request(app).get("/analytics").query({ workspaceId: owner.workspaceId }).set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ total: 3, success: 1, failed: 2 });
    expect(res.body.summary.successRate).toBe(33);
    expect(res.body.topFailingWorkflows[0]).toMatchObject({ failures: 2 });
    expect(Array.isArray(res.body.runsOverTime)).toBe(true);
  });

  it("rejects a missing workspaceId", async () => {
    const owner = await registerUser("analyticsvalid@example.com");
    expect((await request(app).get("/analytics").set(...authHeader(owner.token))).status).toBe(400);
  });
});
