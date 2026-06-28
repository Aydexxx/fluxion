import type { WorkflowNode } from "../dag/types";
import type { ResolvedVariables } from "./types";
import { resolveTemplates, type TemplateScope } from "./template";

/**
 * Builds the template scope a node's config resolves against: the run's trigger
 * payload, every upstream output keyed by node id, an `input` convenience
 * alias — the sole upstream output when there's exactly one source, otherwise
 * the full `{ nodeId: output }` map — and the workspace's `vars`/`secrets`. So
 * `{{ input.text }}` works for the common single-parent case, and
 * `{{ vars.BASE_URL }}` / `{{ secrets.API_TOKEN }}` reach workspace values.
 *
 * `vars`/`secrets` are reserved top-level namespaces spread last, so they always
 * win over an (effectively impossible) node id of "vars"/"secrets".
 *
 * Shared by the full-workflow orchestrator and the single-node tester so a node
 * resolves references identically whether it runs in a real run or a test.
 */
export function buildNodeScope(
  trigger: unknown,
  outputs: Record<string, unknown>,
  sources: Record<string, unknown>,
  variables: ResolvedVariables = { vars: {}, secrets: {} },
): TemplateScope {
  const sourceKeys = Object.keys(sources);
  const input = sourceKeys.length === 1 ? sources[sourceKeys[0]] : sources;
  return { trigger, input, ...outputs, vars: variables.vars, secrets: variables.secrets };
}

/** Returns a copy of `node` with its `config` deeply template-resolved against `scope`. */
export function resolveNodeConfig(node: WorkflowNode, scope: TemplateScope): WorkflowNode {
  return { ...node, config: resolveTemplates(node.config, scope) };
}
