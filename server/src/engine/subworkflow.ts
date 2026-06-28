import type { WorkflowDefinition } from "../dag/types";
import type { RunEventSink, RunLogSink } from "./events";
import type { RunRecord, RunRecorder } from "./persistence";
import type { NodeExecutorRegistry } from "./registry";
import { runWorkflow } from "./runWorkflow";
import type {
  CredentialAccessor,
  DbQueryRunner,
  EmailSender,
  LlmSettings,
  NodeLimits,
  SubworkflowInvocation,
  SubworkflowRunResult,
  SubworkflowRunner,
  VariableResolver,
} from "./types";

/** Default ceiling on sub-workflow nesting (a top-level run is depth 0). */
export const DEFAULT_MAX_SUBWORKFLOW_DEPTH = 5;

/** Thrown when a `flow.subworkflow` call would exceed the max nesting depth. */
export class SubworkflowDepthError extends Error {
  constructor(maxDepth: number) {
    super(`Sub-workflow nesting limit reached (max depth ${maxDepth}). Flatten the call chain or raise the limit.`);
    this.name = "SubworkflowDepthError";
  }
}

/** Thrown when a `flow.subworkflow` call would re-enter a workflow already on the call stack. */
export class SubworkflowCycleError extends Error {
  constructor(targetWorkflowId: string, chain: string[]) {
    super(
      `Sub-workflow cycle detected: workflow "${targetWorkflowId}" is already running in this call chain ` +
        `(${[...chain, targetWorkflowId].join(" → ")}).`,
    );
    this.name = "SubworkflowCycleError";
  }
}

/** Thrown when the target workflow is missing, in another workspace, or has no published version. */
export class SubworkflowTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubworkflowTargetError";
  }
}

/** Resolves a target workflow's *published* definition (the version that production runs). */
export interface PublishedWorkflowLoader {
  /**
   * Loads the published definition for `targetWorkflowId`. Returns the owning
   * workspace so the runner can enforce the same-workspace rule, and null when
   * the workflow doesn't exist or has never been published.
   */
  load(targetWorkflowId: string): Promise<{ workflowId: string; workspaceId: string; definition: WorkflowDefinition } | null>;
}

/** The call-chain context threaded through nested runs for depth + cycle guards. */
export interface SubworkflowCallChain {
  /** Workspace the whole chain runs in; targets must match it. */
  workspaceId: string;
  /** The run that calls the next sub-workflow (the new run's parent). */
  parentRunId: string;
  /** Workflow ids currently on the stack, root-first, including the calling workflow. */
  ancestorWorkflowIds: string[];
  /** Nesting depth of the calling run (0 = top-level). */
  depth: number;
}

/** Everything the runner needs to execute a nested run, independent of the call chain. */
export interface SubworkflowRunnerDeps {
  recorder: RunRecorder;
  registry: NodeExecutorRegistry;
  llm: LlmSettings;
  loader: PublishedWorkflowLoader;
  credentialsFor?: (workspaceId: string) => CredentialAccessor;
  variablesFor?: (workspaceId: string) => VariableResolver;
  email?: EmailSender;
  db?: DbQueryRunner;
  limits?: NodeLimits;
  fetchImpl?: typeof fetch;
  onEvent?: RunEventSink;
  onLog?: RunLogSink;
  /** Max nesting depth; defaults to {@link DEFAULT_MAX_SUBWORKFLOW_DEPTH}. */
  maxDepth?: number;
}

/**
 * Builds a {@link SubworkflowRunner} bound to a point in the call chain. Each
 * nested run gets its own runner (built recursively here) carrying an extended
 * chain, so depth and cycle guards see the full ancestry. Guards run *before*
 * any persistence, so a rejected call never leaves a dangling nested run.
 */
export function createSubworkflowRunner(deps: SubworkflowRunnerDeps, chain: SubworkflowCallChain): SubworkflowRunner {
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_SUBWORKFLOW_DEPTH;

  return {
    async run({ callerNodeId, targetWorkflowId, input }: SubworkflowInvocation): Promise<SubworkflowRunResult> {
      // Depth guard first — cheap, and independent of whether the target resolves.
      const childDepth = chain.depth + 1;
      if (childDepth > maxDepth) throw new SubworkflowDepthError(maxDepth);

      const target = await deps.loader.load(targetWorkflowId);
      if (!target) {
        throw new SubworkflowTargetError(
          `Target workflow "${targetWorkflowId}" was not found or has no published version to call.`,
        );
      }
      if (target.workspaceId !== chain.workspaceId) {
        throw new SubworkflowTargetError(
          `Target workflow "${targetWorkflowId}" is not in this workspace and cannot be called.`,
        );
      }

      // Cycle guard: a workflow already executing in this chain must not re-enter.
      if (chain.ancestorWorkflowIds.includes(target.workflowId)) {
        throw new SubworkflowCycleError(target.workflowId, chain.ancestorWorkflowIds);
      }

      // Create the nested run, linked to its parent run + calling node. Nested
      // runs are recorded as "manual"-triggered; the parent linkage is what marks
      // them as sub-runs. The published definition is snapshotted onto the run.
      const childRunId = await deps.recorder.enqueueRun({
        workflowId: target.workflowId,
        trigger: "manual",
        payload: input,
        definition: target.definition,
        parentRunId: chain.parentRunId,
        parentNodeId: callerNodeId,
      });

      const childChain: SubworkflowCallChain = {
        workspaceId: chain.workspaceId,
        parentRunId: childRunId,
        ancestorWorkflowIds: [...chain.ancestorWorkflowIds, target.workflowId],
        depth: childDepth,
      };

      const record = await runWorkflow({
        runId: childRunId,
        workflowId: target.workflowId,
        workspaceId: target.workspaceId,
        definition: target.definition,
        trigger: { type: "manual", payload: input },
        registry: deps.registry,
        recorder: deps.recorder,
        llm: deps.llm,
        credentials: deps.credentialsFor?.(target.workspaceId),
        variables: deps.variablesFor?.(target.workspaceId),
        email: deps.email,
        db: deps.db,
        limits: deps.limits,
        fetchImpl: deps.fetchImpl,
        onEvent: deps.onEvent,
        onLog: deps.onLog,
        // Recurse: the child can itself call sub-workflows, with the extended chain.
        subworkflows: createSubworkflowRunner(deps, childChain),
      });

      const output = extractSubworkflowOutput(record);
      return { runId: childRunId, status: record.status as "success" | "failed", output, error: record.error };
    },
  };
}

/**
 * Resolves what a sub-workflow "returns" to its caller. Prefers Response
 * (`output.response`) nodes — their `body` is the workflow's declared result. A
 * single response yields its body directly; multiple yield a `{ nodeId: body }`
 * map. With no response node, falls back to the output of terminal (no-outgoing)
 * nodes, and finally null.
 */
export function extractSubworkflowOutput(record: RunRecord): unknown {
  const successById = new Map(
    record.nodeExecutions.filter((n) => n.status === "success").map((n) => [n.nodeId, n.output]),
  );
  const def = record.definition;
  if (!def) return null;

  const responseBody = (output: unknown): unknown => (output as { body?: unknown } | null)?.body ?? null;

  const responses = def.nodes.filter((n) => n.type === "output.response" && successById.has(n.id));
  if (responses.length === 1) return responseBody(successById.get(responses[0].id));
  if (responses.length > 1) {
    return Object.fromEntries(responses.map((n) => [n.id, responseBody(successById.get(n.id))]));
  }

  // No Response node — fall back to whatever the terminal nodes produced.
  const hasOutgoing = new Set(def.edges.map((e) => e.source));
  const terminals = def.nodes.filter((n) => !hasOutgoing.has(n.id) && successById.has(n.id));
  if (terminals.length === 1) return successById.get(terminals[0].id);
  if (terminals.length > 1) return Object.fromEntries(terminals.map((n) => [n.id, successById.get(n.id)]));
  return null;
}
