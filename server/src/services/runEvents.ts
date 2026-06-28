import { prisma } from "./prisma";
import { AUDIT_ACTIONS, safeRecordAudit } from "./audit";
import { createNotification, NOTIFICATION_TYPES } from "./notifications";

/**
 * Records the accountability + awareness side-effects of a run failing
 * terminally (retries exhausted / dead-letter): an audit entry on the run's
 * workspace, and — when the run had a human owner — a notification to them.
 *
 * Entirely best-effort: invoked from the worker's dead-letter path, it must
 * never throw back into queue handling, so every step is guarded.
 */
export async function recordRunFailure(runId: string): Promise<void> {
  try {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      include: { workflow: { select: { name: true, workspaceId: true } } },
    });
    if (!run) return;

    await safeRecordAudit({
      workspaceId: run.workflow.workspaceId,
      action: AUDIT_ACTIONS.runFailed,
      actorId: run.triggeredById ?? null,
      targetType: "run",
      targetId: run.id,
      targetName: run.workflow.name,
      metadata: { workflowId: run.workflowId, error: run.error },
    });

    // Only manual/replay runs have an owner to notify; webhook/schedule runs don't.
    if (run.triggeredById) {
      await createNotification({
        userId: run.triggeredById,
        type: NOTIFICATION_TYPES.runFailed,
        title: `Run failed: ${run.workflow.name}`,
        body: run.error,
        workspaceId: run.workflow.workspaceId,
        data: { runId: run.id, workflowId: run.workflowId },
      });
    }
  } catch {
    // Best-effort: never disrupt dead-letter handling.
  }
}
