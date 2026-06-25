import type { Edge, Node } from "@xyflow/react";
import type { FlowEdgeDef, WorkflowDefinition } from "../lib/types";
import { getNodeSpec } from "./nodeCatalog";

/** Title is persisted inside the freeform `config` under this reserved key. */
const TITLE_KEY = "__title";

export interface FluxNodeData extends Record<string, unknown> {
  /** Domain node type, e.g. "action.http". React Flow's own `node.type` is always "flux". */
  nodeType: string;
  title: string;
  config: Record<string, unknown>;
  /** Mock/sample output pinned to this node, used for design-time data previews and single-node tests. */
  pinned?: unknown;
}

export type FluxNode = Node<FluxNodeData, "flux">;
export type FluxEdge = Edge;

function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/** Build a fresh node of `type` at a flow-space position. */
export function createNode(type: string, position: { x: number; y: number }): FluxNode {
  const spec = getNodeSpec(type);
  return {
    id: uid("node"),
    type: "flux",
    position,
    data: { nodeType: type, title: spec.defaultTitle, config: structuredClone(spec.defaultConfig) },
  };
}

/** Backend definition -> React Flow graph. */
export function definitionToFlow(def: WorkflowDefinition | undefined): { nodes: FluxNode[]; edges: FluxEdge[] } {
  const nodes: FluxNode[] = (def?.nodes ?? []).map((n) => {
    const { [TITLE_KEY]: title, ...config } = n.config ?? {};
    const spec = getNodeSpec(n.type);
    return {
      id: n.id,
      type: "flux",
      position: n.position,
      data: {
        nodeType: n.type,
        title: typeof title === "string" ? title : spec.defaultTitle,
        config,
        ...(n.pinnedData !== undefined ? { pinned: n.pinnedData } : {}),
      },
    };
  });

  const edges: FluxEdge[] = (def?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));

  return { nodes, edges };
}

/** React Flow graph -> backend definition (title folded back into config). */
export function flowToDefinition(nodes: FluxNode[], edges: FluxEdge[]): WorkflowDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: { ...n.data.config, [TITLE_KEY]: n.data.title },
      ...(n.data.pinned !== undefined ? { pinnedData: n.data.pinned } : {}),
    })),
    edges: edges.map((e): FlowEdgeDef => {
      const edge: FlowEdgeDef = { id: e.id, source: e.source, target: e.target };
      if (e.sourceHandle) edge.sourceHandle = e.sourceHandle;
      if (e.targetHandle) edge.targetHandle = e.targetHandle;
      return edge;
    }),
  };
}

export function newEdgeId(): string {
  return uid("edge");
}

/** Immediate upstream (parent) node ids of `target`, de-duplicated. */
export function parentIds(target: string, edges: FluxEdge[]): string[] {
  const seen = new Set<string>();
  for (const e of edges) if (e.target === target) seen.add(e.source);
  return [...seen];
}

/**
 * Transitive upstream node ids of `target` — every node that can reach it along
 * edges — returned nearest-first (direct parents before their parents). Drives
 * the data picker's "available data" tree.
 */
export function ancestorIds(target: string, edges: FluxEdge[]): string[] {
  const parentsOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!parentsOf.has(e.target)) parentsOf.set(e.target, []);
    parentsOf.get(e.target)!.push(e.source);
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  let frontier = parentsOf.get(target) ?? [];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      next.push(...(parentsOf.get(id) ?? []));
    }
    frontier = next;
  }
  return ordered;
}

/**
 * Clone a set of nodes (and the edges *between* them) with fresh ids, offset in
 * flow space. Edges that touch a node outside the set are dropped. The clones are
 * returned pre-selected so a paste/duplicate lands as the new active selection.
 *
 * Pure and id-stable per call — used by copy/paste and duplicate.
 */
export function cloneSubgraph(
  nodes: FluxNode[],
  edges: FluxEdge[],
  offset: { x: number; y: number } = { x: 24, y: 24 },
): { nodes: FluxNode[]; edges: FluxEdge[] } {
  const idMap = new Map<string, string>();

  const clonedNodes: FluxNode[] = nodes.map((n) => {
    const newId = uid("node");
    idMap.set(n.id, newId);
    return {
      ...n,
      id: newId,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      selected: true,
      // Deep-clone config so the copy edits independently of the original.
      data: { ...n.data, config: structuredClone(n.data.config) },
    };
  });

  const clonedEdges: FluxEdge[] = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: newEdgeId(),
      source: idMap.get(e.source) as string,
      target: idMap.get(e.target) as string,
      selected: false,
    }));

  return { nodes: clonedNodes, edges: clonedEdges };
}
