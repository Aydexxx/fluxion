import type { WorkflowEdge, WorkflowNode } from "./types";

/** Thrown by `topologicalSort` when the graph isn't a DAG. */
export class CycleError extends Error {
  constructor(readonly remainingNodeIds: string[]) {
    super(`Workflow definition contains a cycle involving node(s): ${remainingNodeIds.join(", ")}`);
    this.name = "CycleError";
  }
}

/**
 * Kahn's algorithm: returns node ids ordered so every edge points from an
 * earlier id to a later one. Throws `CycleError` if the graph isn't a DAG.
 *
 * Assumes node ids are unique and edges only reference ids present in
 * `nodes` — edges that don't are silently ignored, since reporting that is
 * `validateDefinition`'s job, not this helper's.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const neighbor of adjacency.get(id) ?? []) {
      const remaining = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, remaining);
      if (remaining === 0) queue.push(neighbor);
    }
  }

  if (order.length !== nodes.length) {
    const visited = new Set(order);
    const remainingNodeIds = nodes.map((node) => node.id).filter((id) => !visited.has(id));
    throw new CycleError(remainingNodeIds);
  }

  return order;
}
