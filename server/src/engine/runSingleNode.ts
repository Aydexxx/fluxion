import type { WorkflowDefinition, WorkflowNode } from "../dag/types";
import { buildNodeScope, resolveNodeConfig } from "./nodeScope";
import type { NodeExecutorRegistry } from "./registry";
import { stubCredentialAccessor, stubVariableResolver } from "./runWorkflow";
import type {
  CredentialAccessor,
  DbQueryRunner,
  EmailSender,
  ExecutionContext,
  LlmSettings,
  NodeInput,
  NodeLimits,
  VariableResolver,
} from "./types";

export interface RunSingleNodeParams {
  workspaceId: string;
  definition: WorkflowDefinition;
  /** Id of the node within `definition` to execute in isolation. */
  nodeId: string;
  /** Overrides the saved node config (lets unsaved editor edits be tested). */
  configOverride?: Record<string, unknown>;
  /** Sample trigger payload, referenced via `{{ trigger.* }}`. */
  trigger?: unknown;
  /** Sample outputs for upstream nodes, keyed by node id (e.g. last-run output). */
  sources?: Record<string, unknown>;
  registry: NodeExecutorRegistry;
  llm: LlmSettings;
  credentials?: CredentialAccessor;
  /** Resolves the workspace's variables/secrets so `{{ vars.* }}`/`{{ secrets.* }}` resolve in the test. */
  variables?: VariableResolver;
  fetchImpl?: typeof fetch;
  email?: EmailSender;
  db?: DbQueryRunner;
  limits?: NodeLimits;
}

/** Outcome of a single-node test — mirrors a NodeExecutionRecord's shape, sans ids. */
export interface SingleNodeResult {
  nodeId: string;
  status: "success" | "failed";
  /** The exact `{ trigger, sources }` fed to the executor, for transparency in the UI. */
  input: NodeInput;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/** Thrown when the requested node id isn't present in the definition. */
export class UnknownNodeError extends Error {
  constructor(nodeId: string) {
    super(`Node "${nodeId}" is not part of this workflow`);
    this.name = "UnknownNodeError";
  }
}

/**
 * Executes one node in isolation, the way the editor's "Test this node" affordance
 * needs it: no DAG traversal, no persistence. Upstream context is supplied by the
 * caller (`sources`) and overlaid with any pinned data saved on ancestor nodes,
 * which takes precedence so a node can be built and tested before its upstream
 * neighbours have produced real output.
 *
 * The node's config is template-resolved against the same scope a real run would
 * build (`buildNodeScope`), then the matching executor is invoked once. Timing,
 * status and error are captured and returned; nothing is written anywhere.
 */
export async function runSingleNode(params: RunSingleNodeParams): Promise<SingleNodeResult> {
  const { definition, nodeId, registry } = params;
  const node = definition.nodes.find((n) => n.id === nodeId);
  if (!node) throw new UnknownNodeError(nodeId);

  const ancestors = ancestorIds(definition, nodeId);
  // Effective upstream output for an ancestor: pinned data wins over the
  // caller-supplied sample, which in turn stands in for a real run.
  const outputs = resolveAncestorOutputs(definition, ancestors, params.sources ?? {});

  // Direct parents form `input.sources`; the full ancestor set forms the scope.
  const sources: Record<string, unknown> = {};
  for (const parentId of directParents(definition, nodeId)) {
    if (parentId in outputs) sources[parentId] = outputs[parentId];
  }

  const variables = await (params.variables ?? stubVariableResolver).resolve();
  const config = params.configOverride ?? node.config;
  const scope = buildNodeScope(params.trigger, outputs, sources, variables);
  const resolvedNode: WorkflowNode = resolveNodeConfig({ ...node, config }, scope);

  const input: NodeInput = { trigger: params.trigger, sources };
  const context: ExecutionContext = {
    workspaceId: params.workspaceId,
    trigger: params.trigger,
    credentials: params.credentials ?? stubCredentialAccessor,
    llm: params.llm,
    fetch: params.fetchImpl ?? globalThis.fetch,
    email: params.email,
    db: params.db,
    limits: params.limits,
  };

  const startedAt = new Date();
  const executor = registry.get(node.type);
  if (!executor) {
    const finishedAt = new Date();
    return {
      nodeId,
      status: "failed",
      input,
      output: null,
      error: `No executor registered for node type "${node.type}"`,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  try {
    const output = await executor.execute(resolvedNode, input, context);
    const finishedAt = new Date();
    return {
      nodeId,
      status: "success",
      input,
      output,
      error: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    const finishedAt = new Date();
    return {
      nodeId,
      status: "failed",
      input,
      output: null,
      error: error instanceof Error ? error.message : String(error),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }
}

/** Node ids that can reach `target` along edges (its transitive upstream set). */
function ancestorIds(definition: WorkflowDefinition, target: string): Set<string> {
  const parentsOf = new Map<string, string[]>();
  for (const edge of definition.edges) {
    if (!parentsOf.has(edge.target)) parentsOf.set(edge.target, []);
    parentsOf.get(edge.target)!.push(edge.source);
  }

  const ancestors = new Set<string>();
  const stack = [...(parentsOf.get(target) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    for (const parent of parentsOf.get(id) ?? []) stack.push(parent);
  }
  return ancestors;
}

/** Direct (immediate) parents of `target`, de-duplicated. */
function directParents(definition: WorkflowDefinition, target: string): string[] {
  const seen = new Set<string>();
  for (const edge of definition.edges) {
    if (edge.target === target) seen.add(edge.source);
  }
  return [...seen];
}

/**
 * For each ancestor that has a usable sample output, resolve it with pinned data
 * taking precedence over the caller-supplied source. Ancestors with neither are
 * simply absent — references to them resolve to `undefined`, exactly as in a real
 * run where the node hadn't produced output.
 */
function resolveAncestorOutputs(
  definition: WorkflowDefinition,
  ancestors: Set<string>,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
  const outputs: Record<string, unknown> = {};
  for (const id of ancestors) {
    const node = nodesById.get(id);
    if (node && node.pinnedData !== undefined) {
      outputs[id] = node.pinnedData;
    } else if (id in provided) {
      outputs[id] = provided[id];
    }
  }
  return outputs;
}
