import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../dag/types";
import { CycleError, topologicalSort } from "../dag/topologicalSort";
import { buildNodeScope, resolveNodeConfig } from "./nodeScope";
import type { NodeExecutorRegistry } from "./registry";
import type { RunRecord, RunRecorder } from "./persistence";
import { noopEventSink, type RunEventSink, type RunLogLevel, type RunLogSink } from "./events";
import type {
  CredentialAccessor,
  DbQueryRunner,
  EmailSender,
  ExecutionContext,
  LlmSettings,
  NodeInput,
  NodeLimits,
  RunTriggerValue,
} from "./types";

/** Default accessor for runs with no credential store wired (tests, dry runs): resolves nothing. */
export const stubCredentialAccessor: CredentialAccessor = {
  async resolve() {
    return null;
  },
};

export interface RunWorkflowParams {
  /** Id of an already-created run (queued by the enqueue path) to execute. */
  runId: string;
  workflowId: string;
  workspaceId: string;
  definition: WorkflowDefinition;
  trigger: { type: RunTriggerValue; payload: unknown };
  registry: NodeExecutorRegistry;
  recorder: RunRecorder;
  llm: LlmSettings;
  credentials?: CredentialAccessor;
  fetchImpl?: typeof fetch;
  /** Mail transport for the email node (worker injects a real SMTP sender). */
  email?: EmailSender;
  /** Database client for the database node (worker injects a real Postgres runner). */
  db?: DbQueryRunner;
  /** Default per-node time budgets (worker injects from env). */
  limits?: NodeLimits;
  /** Receives lifecycle events for real-time status propagation. */
  onEvent?: RunEventSink;
  /** Receives structured log lines for live streaming (persistence is via the recorder). */
  onLog?: RunLogSink;
}

/** Per-node error-handling policy, parsed from the node's (control-only) config. */
type OnErrorPolicy = "stop" | "continue" | "route";

interface NodeErrorConfig {
  /** What to do when the node still fails after its retries are exhausted. */
  onError: OnErrorPolicy;
  /** Total attempts for this node within a single run (>=1). 1 means no retry. */
  maxAttempts: number;
  /** Delay between attempts, ms. */
  backoffMs: number;
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Reads error-handling settings off a node's raw config. These are control-flow
 * values (not data), so they're read pre-template-resolution and defaulted
 * conservatively: absent config means the historical behaviour — stop the run,
 * one attempt.
 */
function readErrorConfig(config: Record<string, unknown>): NodeErrorConfig {
  const onError: OnErrorPolicy = config.onError === "continue" || config.onError === "route" ? config.onError : "stop";
  const retry = (config.retry ?? {}) as Record<string, unknown>;
  return {
    onError,
    maxAttempts: clamp(toInt(retry.maxAttempts, 1), 1, 10),
    backoffMs: clamp(toInt(retry.backoffMs, 0), 0, 60_000),
  };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The output a failed-but-handled node exposes downstream, so an error path can read `{{ node.error }}`. */
function errorOutput(message: string): { error: string; errored: true } {
  return { error: message, errored: true };
}

/**
 * Executes a workflow synchronously.
 *
 * Nodes run in topological order. Each node's config is template-resolved
 * against the trigger payload and all upstream outputs collected so far, then
 * the matching executor is invoked with an assembled `{ trigger, sources }`
 * input. Every node's input/output/error/timing is persisted through the
 * recorder, as is the overall run.
 *
 * Failures are first-class. A node may retry itself (per-node `retry` config)
 * and choose an on-error policy:
 *   - `stop` (default): the node and the run fail; downstream halts (fail-fast).
 *   - `continue`: the failure is swallowed; the node exposes an `{ error }`
 *     output and the run proceeds down its normal edges.
 *   - `route`: the failure is caught; only edges from the node's *error* handle
 *     (`sourceHandle: "error"`) fire, enabling try/catch-style branches.
 *
 * Condition nodes gate downstream edges: an edge carrying `sourceHandle`
 * "true"/"false" is dead unless it matches the condition's `branch`. Error
 * edges are dead unless their source actually errored. A node with no live
 * incoming edge is skipped (no execution row).
 */
export async function runWorkflow(params: RunWorkflowParams): Promise<RunRecord> {
  const { runId, definition, registry, recorder, trigger } = params;
  const { nodes, edges } = definition;
  const emit = params.onEvent ?? noopEventSink;

  // Structured, ordered run logs: persisted through the recorder and streamed
  // live via onLog. `seq` gives the UI stable ordering + an incremental cursor.
  let logSeq = 0;
  const log = async (level: RunLogLevel, message: string, nodeId: string | null = null): Promise<void> => {
    logSeq += 1;
    const entry = { seq: logSeq, ts: new Date().toISOString(), level, message, nodeId };
    await recorder.appendRunLog(runId, entry);
    params.onLog?.(runId, entry);
  };

  await recorder.beginRun(runId);
  emit({ type: "run:started", runId, workflowId: params.workflowId });
  await log("info", `Run started · ${nodes.length} node(s), trigger: ${trigger.type}`);

  const context: ExecutionContext = {
    workspaceId: params.workspaceId,
    trigger: trigger.payload,
    credentials: params.credentials ?? stubCredentialAccessor,
    llm: params.llm,
    fetch: params.fetchImpl ?? globalThis.fetch,
    email: params.email,
    db: params.db,
    limits: params.limits,
  };

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByNode = groupIncomingEdges(nodes, edges);

  let order: string[];
  try {
    order = topologicalSort(nodes, edges);
  } catch (error) {
    const message = error instanceof CycleError ? error.message : (error as Error).message;
    await recorder.finishRun(runId, { status: "failed", error: message });
    await log("error", `Run aborted: ${message}`);
    // No run:finished here — on the queue path a failure may still be retried;
    // the worker emits the terminal failed event only once retries are exhausted.
    return recorder.getRun(runId);
  }

  const outputs = new Map<string, unknown>();
  // Nodes that failed and routed to their error path; gates error vs normal edges.
  const errored = new Set<string>();
  let runStatus: "success" | "failed" = "success";
  let runError: string | null = null;

  for (const nodeId of order) {
    const node = nodesById.get(nodeId)!;
    const incoming = incomingByNode.get(nodeId) ?? [];

    if (!shouldRun(incoming, outputs, errored)) {
      await log("debug", `Node ${nodeId} skipped — no live incoming edge`, nodeId);
      continue; // gated out or upstream skipped/failed — no execution row.
    }

    const sources = collectSources(incoming, outputs, errored);
    const input: NodeInput = { trigger: trigger.payload, sources };
    const nodeExecId = await recorder.createNodeExecution({ runId, nodeId, input });
    emit({ type: "node:started", runId, nodeId });
    await log("info", `Node ${nodeId} (${node.type}) started`, nodeId);
    const startedAt = Date.now();

    const executor = registry.get(node.type);
    if (!executor) {
      // A missing executor is a build/config error, not a runtime fault to catch —
      // it always stops the run regardless of the node's on-error policy.
      const message = `No executor registered for node type "${node.type}"`;
      await recorder.finishNodeExecution(nodeExecId, { status: "failed", error: message });
      emit({ type: "node:finished", runId, nodeId, status: "failed", error: message });
      await log("error", `Node ${nodeId} failed: ${message}`, nodeId);
      runStatus = "failed";
      runError = `Node "${nodeId}" failed: ${message}`;
      break;
    }

    const policy = readErrorConfig(node.config);
    const resolvedNode = resolveNodeConfig(node, buildNodeScope(trigger.payload, Object.fromEntries(outputs), sources));

    // Per-node retry: re-invoke up to maxAttempts before the failure is final.
    // This overrides relying on the global queue retry, which re-runs the whole
    // workflow; here a single transient node retries in place within one run.
    let output: unknown;
    let failure: string | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        output = await executor.execute(resolvedNode, input, context);
        failure = null;
        break;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        await log("warn", `Node ${nodeId} attempt ${attempt}/${policy.maxAttempts} failed: ${failure}`, nodeId);
        if (attempt < policy.maxAttempts && policy.backoffMs > 0) await delay(policy.backoffMs);
      }
    }

    if (failure === null) {
      await recorder.finishNodeExecution(nodeExecId, { status: "success", output, attempts });
      emit({ type: "node:finished", runId, nodeId, status: "success" });
      await log("info", `Node ${nodeId} succeeded in ${Date.now() - startedAt}ms`, nodeId);
      outputs.set(nodeId, output);
      continue;
    }

    // The node failed after exhausting its retries; the on-error policy decides
    // whether that stops the run or is handled.
    await recorder.finishNodeExecution(nodeExecId, { status: "failed", error: failure, attempts });
    emit({ type: "node:finished", runId, nodeId, status: "failed", error: failure });

    if (policy.onError === "stop") {
      await log("error", `Node ${nodeId} failed after ${attempts} attempt(s): ${failure}`, nodeId);
      runStatus = "failed";
      runError = `Node "${nodeId}" failed: ${failure}`;
      break; // fail-fast
    }

    // continue | route — the failure is handled, the run proceeds. The node
    // exposes an error output so a downstream handler can read it; `route` also
    // flips edge gating so only the node's error-handle edges fire.
    await log("warn", `Node ${nodeId} failed but handled (${policy.onError}): ${failure}`, nodeId);
    outputs.set(nodeId, errorOutput(failure));
    if (policy.onError === "route") errored.add(nodeId);
  }

  await recorder.finishRun(runId, { status: runStatus, error: runError });
  await log(runStatus === "failed" ? "error" : "info", `Run finished: ${runStatus}`);
  // Emit the terminal event only on success. Failures are emitted by the worker
  // after retries are exhausted (dead-letter), so the editor never shows a hard
  // failure for a run that's about to be retried.
  if (runStatus === "success") {
    emit({ type: "run:finished", runId, status: "success" });
  }
  return recorder.getRun(runId);
}

function groupIncomingEdges(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const map = new Map<string, WorkflowEdge[]>();
  for (const node of nodes) map.set(node.id, []);
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    map.get(edge.target)!.push(edge);
  }
  return map;
}

/**
 * Whether an edge is live given what its source produced:
 *  - the source must have produced an output (ran and wasn't skipped),
 *  - an `error` edge fires only when the source errored (routed),
 *  - a normal/branch edge is dead when the source errored (routed away),
 *  - otherwise the existing true/false branch gating applies.
 */
function isEdgeLive(edge: WorkflowEdge, outputs: Map<string, unknown>, errored: Set<string>): boolean {
  if (!outputs.has(edge.source)) return false;
  const sourceErrored = errored.has(edge.source);
  if (edge.sourceHandle === "error") return sourceErrored;
  if (sourceErrored) return false;
  return !isGatedOut(edge, outputs.get(edge.source));
}

/** A node runs if it's a root (no incoming edges) or has at least one live incoming edge. */
function shouldRun(incoming: WorkflowEdge[], outputs: Map<string, unknown>, errored: Set<string>): boolean {
  if (incoming.length === 0) return true;
  return incoming.some((edge) => isEdgeLive(edge, outputs, errored));
}

/** An edge is gated out when its source emitted a branch signal that doesn't match the edge's `sourceHandle`. */
function isGatedOut(edge: WorkflowEdge, sourceOutput: unknown): boolean {
  if (edge.sourceHandle !== "true" && edge.sourceHandle !== "false") return false;
  const branch = (sourceOutput as { branch?: unknown } | null)?.branch;
  if (branch !== "true" && branch !== "false") return false;
  return branch !== edge.sourceHandle;
}

/** A node's input is assembled only from its live incoming edges. */
function collectSources(
  incoming: WorkflowEdge[],
  outputs: Map<string, unknown>,
  errored: Set<string>,
): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const edge of incoming) {
    if (isEdgeLive(edge, outputs, errored)) sources[edge.source] = outputs.get(edge.source);
  }
  return sources;
}
