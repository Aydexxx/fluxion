import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../dag/types";
import { CycleError, topologicalSort } from "../dag/topologicalSort";
import { resolveTemplates, type TemplateScope } from "./template";
import type { NodeExecutorRegistry } from "./registry";
import type { RunRecord, RunRecorder } from "./persistence";
import { noopEventSink, type RunEventSink } from "./events";
import type {
  CredentialAccessor,
  ExecutionContext,
  LlmSettings,
  NodeInput,
  RunTriggerValue,
} from "./types";

/** Credentials store is wired later; until then nodes get a stub that resolves nothing. */
export const stubCredentialAccessor: CredentialAccessor = {
  async get() {
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
  /** Receives lifecycle events for real-time status propagation. */
  onEvent?: RunEventSink;
}

/**
 * Executes a workflow synchronously, fail-fast.
 *
 * Nodes run in topological order. Each node's config is template-resolved
 * against the trigger payload and all upstream outputs collected so far, then
 * the matching executor is invoked with an assembled `{ trigger, sources }`
 * input. Every node's input/output/error/timing is persisted through the
 * recorder, as is the overall run. The first node to throw marks itself and the
 * run failed and stops execution; the persisted run is returned either way.
 *
 * Condition nodes gate downstream edges: an edge carrying `sourceHandle`
 * "true"/"false" is dead unless it matches the condition's `branch`, and a node
 * with no live incoming edge is skipped (no execution row).
 */
export async function runWorkflow(params: RunWorkflowParams): Promise<RunRecord> {
  const { runId, definition, registry, recorder, trigger } = params;
  const { nodes, edges } = definition;
  const emit = params.onEvent ?? noopEventSink;

  await recorder.beginRun(runId);
  emit({ type: "run:started", runId, workflowId: params.workflowId });

  const context: ExecutionContext = {
    workspaceId: params.workspaceId,
    trigger: trigger.payload,
    credentials: params.credentials ?? stubCredentialAccessor,
    llm: params.llm,
    fetch: params.fetchImpl ?? globalThis.fetch,
  };

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByNode = groupIncomingEdges(nodes, edges);

  let order: string[];
  try {
    order = topologicalSort(nodes, edges);
  } catch (error) {
    const message = error instanceof CycleError ? error.message : (error as Error).message;
    await recorder.finishRun(runId, { status: "failed", error: message });
    // No run:finished here — on the queue path a failure may still be retried;
    // the worker emits the terminal failed event only once retries are exhausted.
    return recorder.getRun(runId);
  }

  const outputs = new Map<string, unknown>();
  let runStatus: "success" | "failed" = "success";
  let runError: string | null = null;

  for (const nodeId of order) {
    const node = nodesById.get(nodeId)!;
    const incoming = incomingByNode.get(nodeId) ?? [];

    if (!shouldRun(incoming, outputs)) {
      continue; // gated out or upstream skipped/failed — no execution row.
    }

    const sources = collectSources(incoming, outputs);
    const input: NodeInput = { trigger: trigger.payload, sources };
    const nodeExecId = await recorder.createNodeExecution({ runId, nodeId, input });
    emit({ type: "node:started", runId, nodeId });

    const executor = registry.get(node.type);
    if (!executor) {
      const message = `No executor registered for node type "${node.type}"`;
      await recorder.finishNodeExecution(nodeExecId, { status: "failed", error: message });
      emit({ type: "node:finished", runId, nodeId, status: "failed", error: message });
      runStatus = "failed";
      runError = `Node "${nodeId}" failed: ${message}`;
      break;
    }

    const resolvedNode = resolveNodeConfig(node, scopeFrom(trigger.payload, outputs, sources));

    try {
      const output = await executor.execute(resolvedNode, input, context);
      await recorder.finishNodeExecution(nodeExecId, { status: "success", output });
      emit({ type: "node:finished", runId, nodeId, status: "success" });
      outputs.set(nodeId, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recorder.finishNodeExecution(nodeExecId, { status: "failed", error: message });
      emit({ type: "node:finished", runId, nodeId, status: "failed", error: message });
      runStatus = "failed";
      runError = `Node "${nodeId}" failed: ${message}`;
      break; // fail-fast: stop the run on the first node error.
    }
  }

  await recorder.finishRun(runId, { status: runStatus, error: runError });
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

/** A node runs if it's a root (no incoming edges) or has at least one live incoming edge. */
function shouldRun(incoming: WorkflowEdge[], outputs: Map<string, unknown>): boolean {
  if (incoming.length === 0) return true;
  return incoming.some((edge) => outputs.has(edge.source) && !isGatedOut(edge, outputs.get(edge.source)));
}

/** An edge is gated out when its source emitted a branch signal that doesn't match the edge's `sourceHandle`. */
function isGatedOut(edge: WorkflowEdge, sourceOutput: unknown): boolean {
  if (edge.sourceHandle !== "true" && edge.sourceHandle !== "false") return false;
  const branch = (sourceOutput as { branch?: unknown } | null)?.branch;
  if (branch !== "true" && branch !== "false") return false;
  return branch !== edge.sourceHandle;
}

function collectSources(incoming: WorkflowEdge[], outputs: Map<string, unknown>): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const edge of incoming) {
    if (outputs.has(edge.source)) sources[edge.source] = outputs.get(edge.source);
  }
  return sources;
}

/**
 * Builds the template scope a node's config resolves against: the trigger
 * payload, every upstream output keyed by node id, and an `input` convenience
 * alias — the sole upstream output when there's exactly one source, otherwise
 * the full `{ nodeId: output }` map. So `{{ input.text }}` works for the common
 * single-parent case without the author needing to know the upstream node id.
 */
function scopeFrom(payload: unknown, outputs: Map<string, unknown>, sources: Record<string, unknown>): TemplateScope {
  const sourceKeys = Object.keys(sources);
  const input = sourceKeys.length === 1 ? sources[sourceKeys[0]] : sources;
  return { trigger: payload, input, ...Object.fromEntries(outputs) };
}

function resolveNodeConfig(node: WorkflowNode, scope: TemplateScope): WorkflowNode {
  return { ...node, config: resolveTemplates(node.config, scope) };
}
