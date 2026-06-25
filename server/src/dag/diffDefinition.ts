import type { WorkflowDefinition, WorkflowNode } from "./types";

/** A single changed node, with a coarse reason so the UI can label it. */
export interface ChangedNode {
  id: string;
  type: string;
  /** What differs: the node type, its config, and/or its position. */
  changes: Array<"type" | "config" | "position">;
}

/**
 * A clear, non-visual summary of how one definition differs from another.
 * Nodes are matched by id: present-in-next-only = added, present-in-prev-only =
 * removed, present-in-both-but-different = changed. Edges are matched by their
 * source→target(+handle) shape (ids are unstable), counted only.
 */
export interface DefinitionDiff {
  addedNodes: Array<{ id: string; type: string }>;
  removedNodes: Array<{ id: string; type: string }>;
  changedNodes: ChangedNode[];
  edgesAdded: number;
  edgesRemoved: number;
  /** True when the two definitions are structurally identical. */
  identical: boolean;
}

function nodeMap(def: WorkflowDefinition): Map<string, WorkflowNode> {
  return new Map(def.nodes.map((n) => [n.id, n]));
}

/** Stable key for an edge by its endpoints + branch handles (ignoring its volatile id). */
function edgeKey(e: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): string {
  return `${e.source}->${e.target}|${e.sourceHandle ?? ""}|${e.targetHandle ?? ""}`;
}

/** Order-independent deep-equality for the JSON-shaped config bag. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
    return true;
  }
  return false;
}

export function diffDefinitions(prev: WorkflowDefinition, next: WorkflowDefinition): DefinitionDiff {
  const prevNodes = nodeMap(prev);
  const nextNodes = nodeMap(next);

  const addedNodes: DefinitionDiff["addedNodes"] = [];
  const removedNodes: DefinitionDiff["removedNodes"] = [];
  const changedNodes: ChangedNode[] = [];

  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id);
    if (!before) {
      addedNodes.push({ id, type: node.type });
      continue;
    }
    const changes: ChangedNode["changes"] = [];
    if (before.type !== node.type) changes.push("type");
    if (!deepEqual(before.config, node.config)) changes.push("config");
    if (before.position.x !== node.position.x || before.position.y !== node.position.y) changes.push("position");
    if (changes.length > 0) changedNodes.push({ id, type: node.type, changes });
  }

  for (const [id, node] of prevNodes) {
    if (!nextNodes.has(id)) removedNodes.push({ id, type: node.type });
  }

  const prevEdges = new Set(prev.edges.map(edgeKey));
  const nextEdges = new Set(next.edges.map(edgeKey));
  let edgesAdded = 0;
  let edgesRemoved = 0;
  for (const k of nextEdges) if (!prevEdges.has(k)) edgesAdded += 1;
  for (const k of prevEdges) if (!nextEdges.has(k)) edgesRemoved += 1;

  const identical =
    addedNodes.length === 0 &&
    removedNodes.length === 0 &&
    changedNodes.length === 0 &&
    edgesAdded === 0 &&
    edgesRemoved === 0;

  return { addedNodes, removedNodes, changedNodes, edgesAdded, edgesRemoved, identical };
}

/** Whether two definitions are structurally equal (the "unpublished changes?" check). */
export function definitionsEqual(a: WorkflowDefinition, b: WorkflowDefinition): boolean {
  return diffDefinitions(a, b).identical;
}
