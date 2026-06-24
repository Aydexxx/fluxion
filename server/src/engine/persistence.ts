import type { ExecutionStatusValue, RunTriggerValue } from "./types";

/** Serializable record of one node's execution within a run. */
export interface NodeExecutionRecord {
  id: string;
  nodeId: string;
  status: ExecutionStatusValue;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Serializable record of a whole workflow run, including its node executions. */
export interface RunRecord {
  id: string;
  workflowId: string;
  status: ExecutionStatusValue;
  trigger: RunTriggerValue;
  payload: unknown;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Origin run id when this run is a replay, else null. */
  replayOfId: string | null;
  nodeExecutions: NodeExecutionRecord[];
}

/**
 * Persistence port the orchestrator writes through. Keeping it an interface
 * lets the engine be unit-tested with an in-memory recorder while production
 * uses the Prisma-backed one — same lifecycle calls, different storage.
 */
export interface RunRecorder {
  /** Create a run in `queued` state (the enqueue path). Returns the new run id. */
  enqueueRun(data: {
    workflowId: string;
    trigger: RunTriggerValue;
    payload: unknown;
    /** Set when this run is a replay of an earlier run. */
    replayOfId?: string | null;
  }): Promise<string>;
  /**
   * Transition an existing run into `running` for a fresh attempt: stamps
   * `startedAt`, clears any error/finish, and discards node executions from a
   * previous attempt so a retry starts clean.
   */
  beginRun(runId: string): Promise<void>;
  /** Put a run back to `queued` between retry attempts (so it doesn't read as a hard failure yet). */
  requeueRun(runId: string): Promise<void>;
  createNodeExecution(data: { runId: string; nodeId: string; input: unknown }): Promise<string>;
  finishNodeExecution(
    id: string,
    data: { status: ExecutionStatusValue; output?: unknown; error?: string | null },
  ): Promise<void>;
  finishRun(id: string, data: { status: ExecutionStatusValue; error?: string | null }): Promise<void>;
  getRun(id: string): Promise<RunRecord>;
}

/**
 * In-memory `RunRecorder` for tests and dry runs. Mirrors the Prisma recorder's
 * lifecycle (create run -> create/finish nodes -> finish run) without a database.
 */
export class InMemoryRunRecorder implements RunRecorder {
  private readonly runs = new Map<string, RunRecord>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async enqueueRun(data: {
    workflowId: string;
    trigger: RunTriggerValue;
    payload: unknown;
    replayOfId?: string | null;
  }): Promise<string> {
    const id = this.nextId("run");
    this.runs.set(id, {
      id,
      workflowId: data.workflowId,
      status: "queued",
      trigger: data.trigger,
      payload: data.payload ?? null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      replayOfId: data.replayOfId ?? null,
      nodeExecutions: [],
    });
    return id;
  }

  async beginRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    run.status = "running";
    run.startedAt = new Date().toISOString();
    run.finishedAt = null;
    run.error = null;
    run.nodeExecutions = []; // fresh attempt
  }

  async requeueRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    run.status = "queued";
    run.finishedAt = null;
    run.error = null;
  }

  async createNodeExecution(data: { runId: string; nodeId: string; input: unknown }): Promise<string> {
    const run = this.requireRun(data.runId);
    const id = this.nextId("node");
    run.nodeExecutions.push({
      id,
      nodeId: data.nodeId,
      status: "running",
      input: data.input ?? null,
      output: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    return id;
  }

  async finishNodeExecution(
    id: string,
    data: { status: ExecutionStatusValue; output?: unknown; error?: string | null },
  ): Promise<void> {
    for (const run of this.runs.values()) {
      const node = run.nodeExecutions.find((n) => n.id === id);
      if (node) {
        node.status = data.status;
        node.output = data.output ?? null;
        node.error = data.error ?? null;
        node.finishedAt = new Date().toISOString();
        return;
      }
    }
    throw new Error(`Unknown node execution: ${id}`);
  }

  async finishRun(id: string, data: { status: ExecutionStatusValue; error?: string | null }): Promise<void> {
    const run = this.requireRun(id);
    run.status = data.status;
    run.error = data.error ?? null;
    run.finishedAt = new Date().toISOString();
  }

  async getRun(id: string): Promise<RunRecord> {
    return structuredClone(this.requireRun(id));
  }

  private requireRun(id: string): RunRecord {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown run: ${id}`);
    return run;
  }
}
