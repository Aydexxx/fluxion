import type { WorkflowDefinition } from "../dag/types";
import type { RunEventSink, RunLogSink } from "../engine/events";
import type { RunRecord, RunRecorder } from "../engine/persistence";
import type { NodeExecutorRegistry } from "../engine/registry";
import { runWorkflow } from "../engine/runWorkflow";
import type { CredentialAccessor, DbQueryRunner, EmailSender, LlmSettings, NodeLimits } from "../engine/types";

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
  /** Builds a workspace-scoped credential accessor; secrets are decrypted only here, on the worker. */
  credentialsFor?: (workspaceId: string) => CredentialAccessor;
  /** Real mail transport for the email node. */
  email?: EmailSender;
  /** Real database client for the database node. */
  db?: DbQueryRunner;
  /** Default per-node time budgets. */
  limits?: NodeLimits;
  fetchImpl?: typeof fetch;
  onEvent?: RunEventSink;
  /** Streams structured log lines as the run executes (persistence is via the recorder). */
  onLog?: RunLogSink;
  /**
   * Called once a run has *terminally* failed (retries exhausted / dead-letter).
   * Used to dispatch the workflow's failure notification. Best-effort: its own
   * failure must never disrupt dead-letter handling.
   */
  onTerminalFailure?: (runId: string) => Promise<void>;
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

  // Prefer the definition snapshotted onto the run at enqueue time, so a draft
  // edit between enqueue and execution can never change what this run executes.
  // `loadWorkflow` still supplies the workspace id (and a fallback definition for
  // pre-snapshot runs).
  const definition = run.definition ?? workflow.definition;

  return runWorkflow({
    runId,
    workflowId: run.workflowId,
    workspaceId: workflow.workspaceId,
    definition,
    trigger: { type: run.trigger, payload: run.payload },
    registry: deps.registry,
    recorder: deps.recorder,
    llm: deps.llm,
    credentials: deps.credentialsFor?.(workflow.workspaceId),
    email: deps.email,
    db: deps.db,
    limits: deps.limits,
    fetchImpl: deps.fetchImpl,
    onEvent: deps.onEvent,
    onLog: deps.onLog,
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
  deps: Pick<ProcessRunDeps, "recorder" | "onEvent" | "onTerminalFailure">,
  params: { runId: string; attemptsMade: number; maxAttempts: number; error: Error },
): Promise<void> {
  const { runId, attemptsMade, maxAttempts, error } = params;
  const exhausted = attemptsMade >= maxAttempts;

  if (exhausted) {
    const message = `Run failed after ${attemptsMade} attempt(s): ${error.message}`;
    await deps.recorder.finishRun(runId, { status: "failed", error: message });
    deps.onEvent?.({ type: "run:finished", runId, status: "failed", error: message });
    // Fire the failure alert after the run is recorded failed, so the notifier
    // reads final state. Never let a notification error mask the dead-letter.
    if (deps.onTerminalFailure) {
      try {
        await deps.onTerminalFailure(runId);
      } catch {
        // swallowed — alerting is best-effort
      }
    }
  } else {
    await deps.recorder.requeueRun(runId);
  }
}
