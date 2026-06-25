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
      // Fallback only — processRun prefers the run's own snapshot. Manual runs snapshot the draft.
      return wf ? { definition: wf.draftDefinition as unknown as WorkflowDefinition, workspaceId: wf.workspaceId } : null;
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
  it("returns a page of runs with workflow names + lineage, newest first", async () => {
    const owner = await registerUser("dash@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const r1 = await startRun(owner.token, workflowId, { topic: "one" });
    await drain(r1);
    const r2 = await startRun(owner.token, workflowId, { topic: "two" });
    await drain(r2);

    const res = await request(app).get("/runs").query({ workspaceId: owner.workspaceId }).set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull(); // only one page
    expect(res.body.runs[0]).toMatchObject({ workflowName: "Flow", status: "success" });
    expect(res.body.runs[0]).toHaveProperty("replayOfId");
  });

  it("filters by status", async () => {
    const owner = await registerUser("dashfilter@example.com");
    const okFlow = await createFlow(owner.token, owner.workspaceId, okDef);
    const badFlow = await createFlow(owner.token, owner.workspaceId, failDef);
    await drain(await startRun(owner.token, okFlow));
    await drain(await startRun(owner.token, badFlow));

    const failed = await request(app).get("/runs").query({ workspaceId: owner.workspaceId, status: "failed" }).set(...authHeader(owner.token));
    expect(failed.body.runs).toHaveLength(1);
    expect(failed.body.runs[0].status).toBe("failed");
  });

  it("filters by trigger type", async () => {
    const owner = await registerUser("dashtrigger@example.com");
    const flow = await createFlow(owner.token, owner.workspaceId);
    await drain(await startRun(owner.token, flow));

    const manual = await request(app).get("/runs").query({ workspaceId: owner.workspaceId, trigger: "manual" }).set(...authHeader(owner.token));
    expect(manual.body.runs).toHaveLength(1);
    const scheduled = await request(app).get("/runs").query({ workspaceId: owner.workspaceId, trigger: "schedule" }).set(...authHeader(owner.token));
    expect(scheduled.body.runs).toHaveLength(0);
  });

  it("searches by workflow name", async () => {
    const owner = await registerUser("dashsearch@example.com");
    const aId = await request(app).post("/workflows").set(...authHeader(owner.token)).send({ workspaceId: owner.workspaceId, name: "Invoices" });
    await request(app).put(`/workflows/${aId.body.id}`).set(...authHeader(owner.token)).send({ definition: okDef });
    const bId = await request(app).post("/workflows").set(...authHeader(owner.token)).send({ workspaceId: owner.workspaceId, name: "Newsletter" });
    await request(app).put(`/workflows/${bId.body.id}`).set(...authHeader(owner.token)).send({ definition: okDef });
    await drain(await startRun(owner.token, aId.body.id));
    await drain(await startRun(owner.token, bId.body.id));

    const res = await request(app).get("/runs").query({ workspaceId: owner.workspaceId, search: "invoic" }).set(...authHeader(owner.token));
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].workflowName).toBe("Invoices");
  });

  it("paginates with a keyset cursor, no overlap between pages", async () => {
    const owner = await registerUser("dashpage@example.com");
    const flow = await createFlow(owner.token, owner.workspaceId);
    for (let i = 0; i < 5; i += 1) await drain(await startRun(owner.token, flow, { i }));

    const page1 = await request(app).get("/runs").query({ workspaceId: owner.workspaceId, limit: 2 }).set(...authHeader(owner.token));
    expect(page1.body.runs).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get("/runs")
      .query({ workspaceId: owner.workspaceId, limit: 2, cursor: page1.body.nextCursor })
      .set(...authHeader(owner.token));
    expect(page2.body.runs).toHaveLength(2);

    const ids1 = page1.body.runs.map((r: { id: string }) => r.id);
    const ids2 = page2.body.runs.map((r: { id: string }) => r.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]); // disjoint pages
  });

  it("rejects a missing workspaceId (validation) and a bad status", async () => {
    const owner = await registerUser("dashvalid@example.com");
    expect((await request(app).get("/runs").set(...authHeader(owner.token))).status).toBe(400);
    expect(
      (await request(app).get("/runs").query({ workspaceId: owner.workspaceId, status: "nope" }).set(...authHeader(owner.token))).status,
    ).toBe(400);
  });
});

describe("GET /runs/:id/logs", () => {
  it("returns a run's structured logs in sequence order", async () => {
    const owner = await registerUser("logs@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const runId = await startRun(owner.token, workflowId, { topic: "comets" });
    await drain(runId);

    const res = await request(app).get(`/runs/${runId}/logs`).set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ seq: 1, level: expect.any(String), message: expect.any(String) });
    // Monotonic seq, and the final line records the run outcome.
    const seqs = res.body.map((l: { seq: number }) => l.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(res.body.at(-1).message).toMatch(/Run finished/);
  });

  it("supports incremental fetch via ?after=", async () => {
    const owner = await registerUser("logsafter@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const runId = await startRun(owner.token, workflowId);
    await drain(runId);

    const all = await request(app).get(`/runs/${runId}/logs`).set(...authHeader(owner.token));
    const tail = await request(app).get(`/runs/${runId}/logs`).query({ after: 2 }).set(...authHeader(owner.token));
    expect(tail.body.every((l: { seq: number }) => l.seq > 2)).toBe(true);
    expect(tail.body).toHaveLength(all.body.length - 2);
  });

  it("forbids a non-member", async () => {
    const owner = await registerUser("logsowner@example.com");
    const outsider = await registerUser("logsoutsider@example.com");
    const workflowId = await createFlow(owner.token, owner.workspaceId);
    const runId = await startRun(owner.token, workflowId);
    await drain(runId);

    const res = await request(app).get(`/runs/${runId}/logs`).set(...authHeader(outsider.token));
    expect(res.status).toBe(403);
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
