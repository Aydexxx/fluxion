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
