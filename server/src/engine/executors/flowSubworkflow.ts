import type { NodeExecutor } from "../types";

interface KeyValueMapping {
  key?: unknown;
  value?: unknown;
}

interface SubworkflowConfig {
  /** Id of the target workflow to call (selected in the editor). */
  workflowId?: string;
  /**
   * Data mapped into the sub-workflow as its trigger payload. Already
   * template-resolved upstream, so `{{ input.* }}` references are concrete here.
   * Accepts the editor's key/value row form (`[{ key, value }]`), a plain record,
   * or any forwarded value; rows are assembled into an object before the call.
   */
  input?: Record<string, unknown> | KeyValueMapping[] | unknown;
}

/** Assembles the sub-workflow's input payload from the node config (rows -> object). */
function resolveInput(input: SubworkflowConfig["input"]): unknown {
  if (Array.isArray(input)) {
    const out: Record<string, unknown> = {};
    for (const { key, value } of input as KeyValueMapping[]) {
      if (typeof key === "string" && key.trim() !== "") out[key] = value;
    }
    return out;
  }
  return input ?? null;
}

export interface SubworkflowOutput {
  /** The nested run's id, linked to this run for traceability. */
  runId: string;
  status: "success" | "failed";
  /** The sub-workflow's resolved output (its Response node's body, or terminal output). */
  output: unknown;
}

/**
 * Calls another workflow in the same workspace as a single step: maps `input`
 * into it, runs its **published** version as a nested run, and exposes the
 * sub-workflow's output as this node's output (under `output`, alongside the
 * nested `runId`/`status`). Nesting depth and cycles are enforced by the runner
 * wired into the execution context; a failed sub-run fails this node (so the
 * usual retry / on-error policy applies).
 */
export const subworkflowExecutor: NodeExecutor = {
  type: "flow.subworkflow",
  async execute(node, _input, context): Promise<SubworkflowOutput> {
    const config = node.config as SubworkflowConfig;
    const targetWorkflowId = config.workflowId;
    if (!targetWorkflowId || typeof targetWorkflowId !== "string") {
      throw new Error("Call Workflow node requires a target 'workflowId' in its config");
    }

    // The runner is wired only on the full-run path. In a single-node test there
    // is nothing to run into, so fail with a clear, actionable message.
    if (!context.subworkflows) {
      throw new Error("Call Workflow can't run in isolation — run the whole workflow to execute the sub-workflow");
    }

    const result = await context.subworkflows.run({
      callerNodeId: node.id,
      targetWorkflowId,
      input: resolveInput(config.input),
    });

    if (result.status === "failed") {
      throw new Error(`Sub-workflow run ${result.runId} failed: ${result.error ?? "unknown error"}`);
    }

    return { runId: result.runId, status: result.status, output: result.output };
  },
};
