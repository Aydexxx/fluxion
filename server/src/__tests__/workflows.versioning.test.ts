import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { env } from "../config/env";
import { prisma } from "../services/prisma";
import { PrismaRunRecorder } from "../engine/prismaRecorder";
import { createDefaultRegistry } from "../engine/registry";
import { processRun } from "../worker/processRun";
import type { WorkflowDefinition } from "../dag/types";

// Hermetic: stub the run queue and cron scheduler so these tests need only
// Postgres, not Redis. We drive the worker's processRun directly to "drain" runs.
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

async function registerUser(name: string, email: string) {
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token as string, workspaceId: res.body.workspace.id as string };
}

/** A webhook → response flow whose response body marks which definition ran. */
function webhookDef(marker: string): WorkflowDefinition {
  return {
    nodes: [
      { id: "t", type: "trigger.webhook", position: { x: 0, y: 0 }, config: {} },
      { id: "out", type: "output.response", position: { x: 200, y: 0 }, config: { body: marker } },
    ],
    edges: [{ id: "e1", source: "t", target: "out" }],
  };
}

async function createWorkflow(token: string, workspaceId: string) {
  const res = await request(app).post("/workflows").set(...authHeader(token)).send({ workspaceId, name: "Versioned" });
  return { id: res.body.id as string, webhookToken: res.body.webhookToken as string };
}

async function saveDraft(token: string, id: string, definition: WorkflowDefinition) {
  return request(app).put(`/workflows/${id}`).set(...authHeader(token)).send({ definition });
}

async function publish(token: string, id: string, note?: string) {
  return request(app).post(`/workflows/${id}/publish`).set(...authHeader(token)).send(note ? { note } : {});
}

/** Simulate the worker consuming the queued job for `runId`. */
async function drainRun(runId: string) {
  return processRun(runId, {
    recorder: new PrismaRunRecorder(prisma),
    loadWorkflow: async (workflowId) => {
      const wf = await prisma.workflow.findUnique({ where: { id: workflowId } });
      return wf ? { definition: { nodes: [], edges: [] }, workspaceId: wf.workspaceId } : null;
    },
    registry: createDefaultRegistry(),
    llm: env.llm,
  });
}

describe("POST /workflows/:id/publish", () => {
  it("snapshots a version and promotes the draft to published", async () => {
    const owner = await registerUser("Ada", "ver-pub@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("V1"));

    const res = await publish(owner.token, wf.id, "first publish");

    expect(res.status).toBe(201);
    expect(res.body.version).toMatchObject({ version: 1, note: "first publish", authorName: "Ada", isCurrent: true });
    expect(res.body.workflow).toMatchObject({ publishedVersion: 1, hasUnpublishedChanges: false });
    expect(res.body.workflow.publishedDefinition).toEqual(webhookDef("V1"));

    // The version row is persisted with the exact definition.
    const versions = await prisma.workflowVersion.findMany({ where: { workflowId: wf.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0].definition).toEqual(webhookDef("V1"));
  });

  it("refuses to publish an invalid draft", async () => {
    const owner = await registerUser("Ada", "ver-pubinvalid@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    // Two triggers → invalid (validateDefinition requires exactly one).
    await saveDraft(owner.token, wf.id, {
      nodes: [
        { id: "t1", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        { id: "t2", type: "trigger.webhook", position: { x: 0, y: 100 }, config: {} },
      ],
      edges: [],
    });

    const res = await publish(owner.token, wf.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.workflowVersion.count({ where: { workflowId: wf.id } })).toBe(0);
  });

  it("flags unpublished changes after a draft edit, without touching published", async () => {
    const owner = await registerUser("Ada", "ver-dirty@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("V1"));
    await publish(owner.token, wf.id);

    await saveDraft(owner.token, wf.id, webhookDef("V2-draft"));

    const res = await request(app).get(`/workflows/${wf.id}`).set(...authHeader(owner.token));
    expect(res.body.hasUnpublishedChanges).toBe(true);
    expect(res.body.definition).toEqual(webhookDef("V2-draft")); // draft is what the editor shows
    expect(res.body.publishedDefinition).toEqual(webhookDef("V1")); // published is unchanged
    expect(res.body.publishedVersion).toBe(1);
  });

  it("requires workspace membership", async () => {
    const owner = await registerUser("Ada", "ver-pubrbac@example.com");
    const outsider = await registerUser("Eve", "ver-pubrbac-eve@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("V1"));

    const res = await publish(outsider.token, wf.id);
    expect(res.status).toBe(403);
  });
});

describe("triggers run the published version, not the draft", () => {
  it("snapshots published for a webhook trigger and draft for a manual run", async () => {
    const owner = await registerUser("Ada", "ver-trigger@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("PUBLISHED"));
    await publish(owner.token, wf.id);

    // Diverge the draft from what's published.
    await saveDraft(owner.token, wf.id, webhookDef("DRAFT"));

    // Webhook trigger → runs the published version.
    const hook = await request(app).post(`/webhooks/${wf.webhookToken}`).send({ hello: "world" });
    expect(hook.status).toBe(202);
    const webhookRun = await prisma.workflowRun.findUnique({ where: { id: hook.body.runId } });
    expect(webhookRun!.definition).toEqual(webhookDef("PUBLISHED"));

    // Manual editor run → runs the draft (so you can test edits before publishing).
    const manual = await request(app).post(`/workflows/${wf.id}/run`).set(...authHeader(owner.token)).send({});
    const manualRun = await prisma.workflowRun.findUnique({ where: { id: manual.body.id } });
    expect(manualRun!.definition).toEqual(webhookDef("DRAFT"));
  });

  it("does not let a draft edit alter an already-queued (active) run", async () => {
    const owner = await registerUser("Ada", "ver-isolation@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("PUBLISHED"));
    await publish(owner.token, wf.id);

    // A webhook run is enqueued against the published snapshot.
    const hook = await request(app).post(`/webhooks/${wf.webhookToken}`).send({});
    const runId = hook.body.runId as string;

    // The user keeps editing the draft while the run sits in the queue.
    await saveDraft(owner.token, wf.id, webhookDef("DRAFT"));

    // When the worker finally drains it, it executes the snapshot — not the new draft.
    const result = await drainRun(runId);
    expect(result.status).toBe("success");
    const stored = await prisma.workflowRun.findUnique({ where: { id: runId }, include: { nodeExecutions: true } });
    const out = stored!.nodeExecutions.find((n) => n.nodeId === "out");
    expect(out!.output).toEqual({ body: "PUBLISHED" });
  });
});

describe("version history + rollback", () => {
  it("lists versions newest-first with a diff summary and a current marker", async () => {
    const owner = await registerUser("Ada", "ver-list@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("V1"));
    await publish(owner.token, wf.id);
    await saveDraft(owner.token, wf.id, webhookDef("V2"));
    await publish(owner.token, wf.id);

    const res = await request(app).get(`/workflows/${wf.id}/versions`).set(...authHeader(owner.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ version: 2, isCurrent: true });
    expect(res.body[1]).toMatchObject({ version: 1, isCurrent: false });
    // v1's diff is against empty (all nodes added); v2's diff is against v1 (the body node changed).
    expect(res.body[1].diff.addedNodes).toHaveLength(2);
    expect(res.body[0].diff.changedNodes).toHaveLength(1);
  });

  it("rolls back by re-publishing an old version as a new one", async () => {
    const owner = await registerUser("Ada", "ver-rollback@example.com");
    const wf = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, wf.id, webhookDef("V1"));
    const v1 = await publish(owner.token, wf.id);
    await saveDraft(owner.token, wf.id, webhookDef("V2"));
    await publish(owner.token, wf.id);

    const versionOneId = v1.body.version.id as string;
    const res = await request(app)
      .post(`/workflows/${wf.id}/versions/${versionOneId}/rollback`)
      .set(...authHeader(owner.token))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.version).toMatchObject({ version: 3, note: "Rolled back to v1", isCurrent: true });
    // Both the published def and the draft now match v1 again.
    expect(res.body.workflow.publishedDefinition).toEqual(webhookDef("V1"));
    expect(res.body.workflow.definition).toEqual(webhookDef("V1"));
    expect(res.body.workflow.hasUnpublishedChanges).toBe(false);

    // History is append-only: v1 and v2 still exist, plus the new v3.
    expect(await prisma.workflowVersion.count({ where: { workflowId: wf.id } })).toBe(3);

    // A subsequent webhook run executes the rolled-back (V1) definition.
    const hook = await request(app).post(`/webhooks/${wf.webhookToken}`).send({});
    const run = await prisma.workflowRun.findUnique({ where: { id: hook.body.runId } });
    expect(run!.definition).toEqual(webhookDef("V1"));
  });

  it("404s a rollback to a version from another workflow", async () => {
    const owner = await registerUser("Ada", "ver-rollback404@example.com");
    const a = await createWorkflow(owner.token, owner.workspaceId);
    const b = await createWorkflow(owner.token, owner.workspaceId);
    await saveDraft(owner.token, a.id, webhookDef("A1"));
    const aV1 = await publish(owner.token, a.id);

    const res = await request(app)
      .post(`/workflows/${b.id}/versions/${aV1.body.version.id}/rollback`)
      .set(...authHeader(owner.token))
      .send({});
    expect(res.status).toBe(404);
  });
});
