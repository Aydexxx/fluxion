import { Queue } from "bullmq";
import { env } from "../config/env";
import { createRedisConnection } from "./connection";

export const WORKFLOW_RUNS_QUEUE = "workflow-runs";

/** Payload carried by each queued run job. */
export interface WorkflowRunJobData {
  runId: string;
  workflowId: string;
  payload: unknown;
}

// Lazily constructed so importing this module (e.g. in tests that mock it)
// doesn't open a Redis connection.
let queue: Queue<WorkflowRunJobData> | null = null;

export function getWorkflowQueue(): Queue<WorkflowRunJobData> {
  if (!queue) {
    queue = new Queue<WorkflowRunJobData>(WORKFLOW_RUNS_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // Retry with exponential backoff on transient failures.
        attempts: env.queue.attempts,
        backoff: { type: "exponential", delay: env.queue.backoffMs },
        // Keep recent completed jobs for inspection; keep all failures for the
        // dead-letter trail (the failed WorkflowRun row is the source of truth).
        removeOnComplete: { count: 200 },
        removeOnFail: false,
      },
    });
  }
  return queue;
}

/**
 * Enqueue a run for asynchronous execution. The job id is the run id, so a
 * given run can only ever be queued once — BullMQ dedupes by job id, giving us
 * idempotency against duplicate enqueues.
 */
export async function enqueueWorkflowRun(data: WorkflowRunJobData): Promise<void> {
  await getWorkflowQueue().add("run", data, { jobId: data.runId });
}
