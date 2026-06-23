import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

// Hermetic: stub the run queue and the cron scheduler so these tests need only
// Postgres, not Redis.
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

const webhookDef = {
  nodes: [
    { id: "t", type: "trigger.webhook", position: { x: 0, y: 0 }, config: {} },
    { id: "out", type: "output.response", position: { x: 200, y: 0 }, config: { body: "{{ t.body }}" } },
  ],
  edges: [{ id: "e1", source: "t", target: "out" }],
};

async function createWebhookWorkflow(token: string, workspaceId: string, isActive = true) {
  const created = await request(app).post("/workflows").set(...authHeader(token)).send({ workspaceId, name: "Hooked" });
  await request(app).put(`/workflows/${created.body.id}`).set(...authHeader(token)).send({ definition: webhookDef, isActive });
  return { id: created.body.id as string, webhookToken: created.body.webhookToken as string };
}

describe("POST /webhooks/:token", () => {
  it("generates an unguessable token on the workflow", async () => {
    const owner = await registerUser("hook1@example.com");
    const wf = await createWebhookWorkflow(owner.token, owner.workspaceId);
    expect(wf.webhookToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("enqueues a run with the request body as the trigger payload", async () => {
    const owner = await registerUser("hook2@example.com");
    const wf = await createWebhookWorkflow(owner.token, owner.workspaceId);

    const res = await request(app)
      .post(`/webhooks/${wf.webhookToken}`)
      .set("X-Custom", "abc")
      .send({ hello: "world" });

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.runId).toBeTruthy();

    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: res.body.runId,
        workflowId: wf.id,
        payload: expect.objectContaining({ body: { hello: "world" } }),
      }),
    );

    const run = await prisma.workflowRun.findUnique({ where: { id: res.body.runId } });
    expect(run!.status).toBe("queued");
    expect(run!.trigger).toBe("webhook");
    expect((run!.payload as { body: unknown }).body).toEqual({ hello: "world" });
    expect((run!.payload as { headers: Record<string, string> }).headers["x-custom"]).toBe("abc");
  });

  it("does not fire for an inactive workflow", async () => {
    const owner = await registerUser("hook3@example.com");
    const wf = await createWebhookWorkflow(owner.token, owner.workspaceId, false);

    const res = await request(app).post(`/webhooks/${wf.webhookToken}`).send({ hello: "world" });

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await prisma.workflowRun.count({ where: { workflowId: wf.id } })).toBe(0);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app).post("/webhooks/this-token-does-not-exist").send({});
    expect(res.status).toBe(404);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
