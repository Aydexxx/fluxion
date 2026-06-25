import type { WorkflowRun } from "../lib/types";
import { ancestorIds, parentIds, type FluxEdge, type FluxNode } from "./graph";
import { getNodeSpec } from "./nodeCatalog";
import type { Scope } from "./references";

/** Where a node's sample data came from, in precedence order. */
export type SampleOrigin = "pinned" | "lastrun" | "none";

/** One selectable data source in the picker tree (an upstream node, or the trigger). */
export interface SampleSource {
  /** Node id this sample belongs to. */
  id: string;
  title: string;
  nodeType: string;
  /** Reference prefix inserted for fields under this source (`trigger` or the node id). */
  basePath: string;
  /** The sample value (pinned mock or last-run output); `undefined` when origin is "none". */
  sample: unknown;
  origin: SampleOrigin;
}

export interface SampleScope {
  /** Resolution scope for `{{ }}` previews: `{ trigger, input, [nodeId]: sample }`. */
  scope: Scope;
  /** Upstream sources for the picker, nearest-first; trigger sources surface first. */
  sources: SampleSource[];
}

function isTrigger(nodeType: string): boolean {
  return getNodeSpec(nodeType).category === "trigger";
}

/** Resolve a node's sample output: pinned mock wins over the last run's captured output. */
function sampleFor(node: FluxNode, run: WorkflowRun | null): { sample: unknown; origin: SampleOrigin } {
  if (node.data.pinned !== undefined) return { sample: node.data.pinned, origin: "pinned" };
  const exec = run?.nodeExecutions.find((e) => e.nodeId === node.id);
  if (exec && exec.output !== undefined && exec.output !== null) {
    return { sample: exec.output, origin: "lastrun" };
  }
  return { sample: undefined, origin: "none" };
}

/**
 * Builds the design-time data context for a node: the resolution scope used by
 * reference previews, and the ordered list of upstream sources the data picker
 * offers. A node's sample is its pinned mock data if present, else its output
 * from the active run, else nothing. Trigger-type ancestors are surfaced under
 * the canonical `trigger` prefix so picking a field inserts `{{ trigger.x }}`.
 */
export function buildSampleScope(
  nodes: FluxNode[],
  edges: FluxEdge[],
  run: WorkflowRun | null,
  targetId: string,
): SampleScope {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ancestors = ancestorIds(targetId, edges);
  const parents = parentIds(targetId, edges);

  const scope: Scope = {};
  const sources: SampleSource[] = [];

  for (const id of ancestors) {
    const node = byId.get(id);
    if (!node) continue;
    const trigger = isTrigger(node.data.nodeType);
    let { sample, origin } = sampleFor(node, run);
    // A trigger node's output is the run's trigger payload, which is stored on the
    // run itself rather than as a node execution — fall back to it.
    if (trigger && origin === "none" && run != null && run.payload != null) {
      sample = run.payload;
      origin = "lastrun";
    }
    const basePath = trigger ? "trigger" : id;

    if (origin !== "none") {
      scope[id] = sample;
      if (trigger) scope.trigger = sample;
    }
    sources.push({ id, title: node.data.title, nodeType: node.data.nodeType, basePath, sample, origin });
  }

  // `input` alias: the sole direct parent's sample, mirroring the engine scope.
  if (parents.length === 1 && parents[0] in scope) scope.input = scope[parents[0]];

  // Trigger sources first (they're the run's entry data), then nearest ancestors.
  sources.sort((a, b) => Number(isTrigger(b.nodeType)) - Number(isTrigger(a.nodeType)));
  return { scope, sources };
}

/** A node id → sample-output map for the test endpoint's `sources` payload (last-run only; pinned is applied server-side). */
export function lastRunSources(run: WorkflowRun | null): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const exec of run?.nodeExecutions ?? []) {
    if (exec.output !== undefined && exec.output !== null) sources[exec.nodeId] = exec.output;
  }
  return sources;
}
