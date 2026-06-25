import type { PrismaClient } from "../generated/prisma/client";
import { parseFailureNotify, sendFailureNotification } from "../engine/failureNotifier";
import type { CredentialAccessor, EmailSender } from "../engine/types";

export interface FailureNotifierDeps {
  prisma: PrismaClient;
  /** Workspace-scoped credential accessor (secrets decrypted on the worker). */
  credentialsFor: (workspaceId: string) => CredentialAccessor;
  email?: EmailSender;
  fetchImpl?: typeof fetch;
}

/**
 * Loads a terminally-failed run and, if its workflow has a failure-alert
 * configured, sends it. Resolves the failing node from the run's executions so
 * the alert names exactly where it broke. No-op when no alert is configured.
 */
export async function dispatchFailureNotification(runId: string, deps: FailureNotifierDeps): Promise<void> {
  const run = await deps.prisma.workflowRun.findUnique({
    where: { id: runId },
    include: {
      workflow: { select: { name: true, workspaceId: true, failureNotify: true } },
      nodeExecutions: { where: { status: "failed" }, orderBy: { finishedAt: "asc" }, take: 1 },
    },
  });
  if (!run) return;

  const notify = parseFailureNotify(run.workflow.failureNotify);
  if (!notify) return;

  await sendFailureNotification({
    notify,
    run: {
      runId: run.id,
      workflowName: run.workflow.name,
      failingNodeId: run.nodeExecutions[0]?.nodeId ?? null,
      error: run.error,
    },
    workspaceId: run.workflow.workspaceId,
    credentials: deps.credentialsFor(run.workflow.workspaceId),
    email: deps.email,
    fetchImpl: deps.fetchImpl,
  });
}
