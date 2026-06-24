import { Worker } from "bullmq";
import { env } from "./config/env";
import { logger } from "./config/logger";
import type { WorkflowDefinition } from "./dag/types";
import { createDefaultRegistry } from "./engine/registry";
import { PrismaRunRecorder } from "./engine/prismaRecorder";
import { nodemailerSender } from "./engine/clients/email";
import { pgQueryRunner } from "./engine/clients/db";
import { createPrismaCredentialAccessor } from "./services/credentials";
import { createRedisConnection } from "./queue/connection";
import { WORKFLOW_RUNS_QUEUE, type WorkflowRunJobData } from "./queue/workflowQueue";
import { WORKFLOW_SCHEDULES_QUEUE, type ScheduleJobData } from "./queue/scheduleQueue";
import { createRunEventEmitter } from "./realtime/emitter";
import { handleJobFailure, runJob, type ProcessRunDeps } from "./worker/processRun";
import { enqueueRunForWorkflow } from "./services/runs";
import { prisma } from "./services/prisma";

/**
 * Worker entrypoint — a separate process from the API. Consumes the
 * `workflow-runs` queue and executes runs through the shared engine, emitting
 * live status to the editor via Socket.IO (Redis). Run with `npm run worker`.
 */
const connection = createRedisConnection();
const { sink: onEvent, close: closeEmitter } = createRunEventEmitter();
const recorder = new PrismaRunRecorder(prisma);

const deps: ProcessRunDeps = {
  recorder,
  loadWorkflow: async (workflowId) => {
    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) return null;
    return { definition: workflow.definition as unknown as WorkflowDefinition, workspaceId: workflow.workspaceId };
  },
  registry: createDefaultRegistry(),
  llm: env.llm,
  // Secrets are resolved + decrypted here, per run, scoped to the run's workspace.
  credentialsFor: createPrismaCredentialAccessor,
  email: nodemailerSender,
  db: pgQueryRunner,
  limits: { httpTimeoutMs: env.nodeTimeouts.httpMs, aiTimeoutMs: env.nodeTimeouts.aiMs },
  onEvent,
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
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
