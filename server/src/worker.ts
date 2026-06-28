import { Worker } from "bullmq";
import { env } from "./config/env";
import { logger } from "./config/logger";
import type { WorkflowDefinition } from "./dag/types";
import { createDefaultRegistry } from "./engine/registry";
import { PrismaRunRecorder } from "./engine/prismaRecorder";
import { nodemailerSender } from "./engine/clients/email";
import { pgQueryRunner } from "./engine/clients/db";
import { createPrismaCredentialAccessor } from "./services/credentials";
import { createPrismaVariableResolver } from "./services/variables";
import { createRedisConnection } from "./queue/connection";
import { WORKFLOW_RUNS_QUEUE, type WorkflowRunJobData } from "./queue/workflowQueue";
import { WORKFLOW_SCHEDULES_QUEUE, type ScheduleJobData } from "./queue/scheduleQueue";
import { createRunEventEmitter } from "./realtime/emitter";
import { createNotificationEmitter } from "./realtime/notificationEmitter";
import { setNotificationPublisher } from "./realtime/notifications";
import { handleJobFailure, runJob, type ProcessRunDeps } from "./worker/processRun";
import { dispatchFailureNotification } from "./worker/failureNotifier";
import { recordRunFailure } from "./services/runEvents";
import { enqueueRunForWorkflow } from "./services/runs";
import { prisma } from "./services/prisma";

/**
 * Worker entrypoint — a separate process from the API. Consumes the
 * `workflow-runs` queue and executes runs through the shared engine, emitting
 * live status to the editor via Socket.IO (Redis). Run with `npm run worker`.
 */
const connection = createRedisConnection();
const { sink: onEvent, logSink: onLog, close: closeEmitter } = createRunEventEmitter();
// Run-failure notifications are created on the worker; wire them to the user
// channel so an owner sees their failed run light up the bell in real time.
const { publisher: notificationPublisher, close: closeNotificationEmitter } = createNotificationEmitter();
setNotificationPublisher(notificationPublisher);
const recorder = new PrismaRunRecorder(prisma);

const deps: ProcessRunDeps = {
  recorder,
  loadWorkflow: async (workflowId) => {
    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) return null;
    // Fallback only — the run's own definition snapshot is preferred (see processRun).
    // For triggers, the published definition is what production runs.
    const published = (workflow.publishedDefinition as unknown as WorkflowDefinition | null) ?? { nodes: [], edges: [] };
    return { definition: published, workspaceId: workflow.workspaceId };
  },
  // Resolves a sub-workflow target's *published* definition for the Call Workflow
  // node — the published-version rule. Same-workspace enforcement happens in the runner.
  loadPublishedWorkflow: async (workflowId) => {
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, workspaceId: true, publishedDefinition: true },
    });
    if (!workflow || workflow.publishedDefinition == null) return null;
    return {
      workflowId: workflow.id,
      workspaceId: workflow.workspaceId,
      definition: workflow.publishedDefinition as unknown as WorkflowDefinition,
    };
  },
  registry: createDefaultRegistry(),
  llm: env.llm,
  // Secrets are resolved + decrypted here, per run, scoped to the run's workspace.
  credentialsFor: createPrismaCredentialAccessor,
  // Workspace variables/secrets are likewise resolved + decrypted on the worker.
  variablesFor: createPrismaVariableResolver,
  email: nodemailerSender,
  db: pgQueryRunner,
  limits: { httpTimeoutMs: env.nodeTimeouts.httpMs, aiTimeoutMs: env.nodeTimeouts.aiMs },
  maxSubworkflowDepth: env.subworkflow.maxDepth,
  onEvent,
  onLog,
  // On dead-letter: record the failure for the audit log + notify the run's
  // owner, then alert the workflow's configured channel (all best-effort).
  onTerminalFailure: async (runId) => {
    await recordRunFailure(runId);
    await dispatchFailureNotification(runId, {
      prisma,
      credentialsFor: createPrismaCredentialAccessor,
      email: nodemailerSender,
    });
  },
};

const worker = new Worker<WorkflowRunJobData>(
  WORKFLOW_RUNS_QUEUE,
  async (job) => {
    const log = logger.child({ runId: job.data.runId, workflowId: job.data.workflowId, attempt: job.attemptsMade + 1 });
    log.info("run.started");
    const result = await runJob(job.data.runId, deps);
    log.info({ status: result.status }, "run.finished");
  },
  { connection, concurrency: env.queue.concurrency },
);

// Retry/dead-letter reconciliation: between attempts the run goes back to
// `queued`; once attempts are exhausted it's recorded `failed` with context.
worker.on("failed", async (job, err) => {
  if (!job) return;
  logger.warn({ runId: job.data.runId, attempt: job.attemptsMade, err: err?.message }, "run.attempt.failed");
  await handleJobFailure(deps, {
    runId: job.data.runId,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? env.queue.attempts,
    error: err instanceof Error ? err : new Error(String(err)),
  });
});

worker.on("completed", (job) => {
  logger.info({ runId: job.data.runId }, "run.completed");
});

worker.on("error", (err) => {
  logger.error({ err }, "worker.error");
});

// Scheduler worker: each cron tick is a job here; turn it into a real run
// (re-checking isActive defensively, in case the workflow was just disabled).
const scheduleWorker = new Worker<ScheduleJobData>(
  WORKFLOW_SCHEDULES_QUEUE,
  async (job) => {
    const workflow = await prisma.workflow.findUnique({
      where: { id: job.data.workflowId },
      select: { isActive: true },
    });
    if (!workflow?.isActive) return;
    await enqueueRunForWorkflow(job.data.workflowId, "schedule", {
      nodeId: job.data.nodeId,
      firedAt: new Date().toISOString(),
    });
  },
  { connection: createRedisConnection() },
);

scheduleWorker.on("error", (err) => {
  logger.error({ err }, "scheduler.error");
});

logger.info(
  { queue: WORKFLOW_RUNS_QUEUE, concurrency: env.queue.concurrency, attempts: env.queue.attempts },
  "worker.listening",
);
logger.info({ queue: WORKFLOW_SCHEDULES_QUEUE }, "scheduler.listening");

async function shutdown(): Promise<void> {
  await worker.close();
  await scheduleWorker.close();
  await closeEmitter();
  await closeNotificationEmitter();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
