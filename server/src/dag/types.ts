export interface NodePosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: NodePosition;
  config: Record<string, unknown>;
  /**
   * Optional mock/sample output pinned to this node. When present it stands in
   * for the node's real output during single-node tests and design-time data
   * previews, so downstream nodes can be built before this one has run for real.
   */
  pinnedData?: unknown;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
