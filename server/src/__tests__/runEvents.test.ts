import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../services/prisma";
import { recordRunFailure } from "../services/runEvents";

/**
 * Run-failure accountability + awareness: a terminally failed run records a
 * `run.failed` audit entry and notifies the run's owner. Exercised at the
 * service level against the real DB (the queue/dead-letter wiring is the
 * worker's; this verifies the side-effects it triggers).
 */

beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

const EMPTY_DEF = { nodes: [], edges: [] };

/** Build a workspace with one user + workflow, and a failed run (optionally owned). */
async function failedRun(opts: { triggeredById?: string | null } = {}) {
  const user = await prisma.user.create({
    data: { name: "Ada", email: `owner${Math.random()}@example.com`, passwordHash: "x" },
  });
  const workspace = await prisma.workspace.create({
    data: { name: "WS", ownerId: user.id, members: { create: { userId: user.id, role: "owner" } } },
  });
  const workflow = await prisma.workflow.create({
    data: { workspaceId: workspace.id, name: "Nightly Sync", draftDefinition: EMPTY_DEF },
  });
  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      trigger: "manual",
      status: "failed",
      error: "boom at node X",
      triggeredById: opts.triggeredById === undefined ? user.id : opts.triggeredById,
    },
  });
  return { user, workspace, workflow, run };
}

describe("recordRunFailure", () => {
  it("records a run.failed audit entry on the run's workspace", async () => {
    const { workspace, workflow, run } = await failedRun();

    await recordRunFailure(run.id);

    const entries = await prisma.auditLog.findMany({ where: { workspaceId: workspace.id, action: "run.failed" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetType: "run", targetId: run.id, targetName: "Nightly Sync" });
    expect((entries[0].metadata as { workflowId: string }).workflowId).toBe(workflow.id);
  });

  it("notifies the run's owner that their run failed", async () => {
    const { user, run } = await failedRun();

    await recordRunFailure(run.id);

    const notifs = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ type: "run.failed", read: false });
    expect(notifs[0].title).toContain("Nightly Sync");
    expect((notifs[0].data as { runId: string }).runId).toBe(run.id);
  });

  it("records the audit entry but notifies no one for an owner-less (scheduled) run", async () => {
    const { workspace, run } = await failedRun({ triggeredById: null });

    await recordRunFailure(run.id);

    const audit = await prisma.auditLog.count({ where: { workspaceId: workspace.id, action: "run.failed" } });
    expect(audit).toBe(1);
    const notifs = await prisma.notification.count();
    expect(notifs).toBe(0);
  });
});
