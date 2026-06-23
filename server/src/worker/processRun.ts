import type { WorkflowDefinition } from "../dag/types";
import type { RunEventSink } from "../engine/events";
import type { RunRecord, RunRecorder } from "../engine/persistence";
import type { NodeExecutorRegistry } from "../engine/registry";
import { runWorkflow } from "../engine/runWorkflow";
import type { LlmSettings } from "../engine/types";

/** Thrown when a run finishes in a failed state, so the queue treats the job as failed and retries. */
export class RunFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunFailedError";
  }
}

export interface ProcessRunDeps {
  recorder: RunRecorder;
  /** Resolves the saved definition + owning workspace for a workflow. */
  loadWorkflow: (workflowId: string) => Promise<{ definition: WorkflowDefinition; workspaceId: string } | null>;
  registry: NodeExecutorRegistry;
  llm: LlmSettings;
  fetchImpl?: typeof fetch;
  onEvent?: RunEventSink;
}

/**
 * Executes one queued run through the shared engine.
 *
 * Idempotency: if the run is already `success`, it returns immediately without
 * re-executing — combined with `jobId === runId` enqueue dedup, a run executes
 * at most once to completion. Returns the finished `RunRecord` (does not throw
 * on a failed run; the caller decides whether to surface that as a retryable
 * job failure).
 */
export async function processRun(runId: string, deps: ProcessRunDeps): Promise<RunRecord> {
  const run = await deps.recorder.getRun(runId);
  if (run.status === "success") return run; // already executed — idempotent no-op

  const workflow = await deps.loadWorkflow(run.workflowId);
  if (!workflow) throw new Error(`Workflow ${run.workflowId} not found for run ${runId}`);

  return runWorkflow({
    runId,
    workflowId: run.workflowId,
    workspaceId: workflow.workspaceId,
    definition: workflow.definition,
    trigger: { type: run.trigger, payload: run.payload },
    registry: deps.registry,
    recorder: deps.recorder,
    llm: deps.llm,
    fetchImpl: deps.fetchImpl,
    onEvent: deps.onEvent,
  });
}

/**
 * The BullMQ job processor. Runs the engine and, if the run failed, throws so
 * the queue records the attempt as failed and applies retry/backoff.
 */
export async function runJob(runId: string, deps: ProcessRunDeps): Promise<RunRecord> {
  const result = await processRun(runId, deps);
  if (result.status === "failed") {
    throw new RunFailedError(result.error ?? "Run failed");
  }
  return result;
}

/**
 * Reconciles run state after a job attempt fails. Between retries the run is
 * put back to `queued`; once attempts are exhausted (dead-letter) it is recorded
 * as `failed` with the full error context, and a terminal run:finished is emitted.
 */
export async function handleJobFailure(
  deps: Pick<ProcessRunDeps, "recorder" | "onEvent">,
  params: { runId: string; attemptsMade: number; maxAttempts: number; error: Error },
): Promise<void> {
  const { runId, attemptsMade, maxAttempts, error } = params;
  const exhausted = attemptsMade >= maxAttempts;

  if (exhausted) {
    const message = `Run failed after ${attemptsMade} attempt(s): ${error.message}`;
    await deps.recorder.finishRun(runId, { status: "failed", error: message });
    deps.onEvent?.({ type: "run:finished", runId, status: "failed", error: message });
  } else {
    await deps.recorder.requeueRun(runId);
  }
}
