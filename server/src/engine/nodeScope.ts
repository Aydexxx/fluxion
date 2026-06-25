import type { WorkflowNode } from "../dag/types";
import { resolveTemplates, type TemplateScope } from "./template";

/**
 * Builds the template scope a node's config resolves against: the run's trigger
 * payload, every upstream output keyed by node id, and an `input` convenience
 * alias — the sole upstream output when there's exactly one source, otherwise
 * the full `{ nodeId: output }` map. So `{{ input.text }}` works for the common
 * single-parent case without the author needing to know the upstream node id.
 *
 * Shared by the full-workflow orchestrator and the single-node tester so a node
 * resolves references identically whether it runs in a real run or a test.
 */
export function buildNodeScope(
  trigger: unknown,
  outputs: Record<string, unknown>,
  sources: Record<string, unknown>,
): TemplateScope {
  const sourceKeys = Object.keys(sources);
  const input = sourceKeys.length === 1 ? sources[sourceKeys[0]] : sources;
  return { trigger, input, ...outputs };
}

/** Returns a copy of `node` with its `config` deeply template-resolved against `scope`. */
export function resolveNodeConfig(node: WorkflowNode, scope: TemplateScope): WorkflowNode {
  return { ...node, config: resolveTemplates(node.config, scope) };
}
