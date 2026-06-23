import type { WorkflowDefinition, WorkflowEdge } from "./types";
import { isKnownNodeType, isTriggerNodeType } from "./nodeTypes";
import { CycleError, topologicalSort } from "./topologicalSort";

export interface DagValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates the graph-semantic rules of a workflow definition: every edge
 * must reference real nodes, the graph must be acyclic, and there must be
 * exactly one trigger node. Disconnected non-trigger nodes only warn.
 *
 * A completely empty definition (no nodes, no edges) is treated as valid —
 * it's the placeholder state a workflow starts in right after creation,
 * before anyone has dragged a node onto the canvas.
 */
export function validateDefinition(definition: WorkflowDefinition): DagValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { nodes, edges } = definition;

  if (nodes.length === 0 && edges.length === 0) {
    return { valid: true, errors, warnings };
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) errors.push(`Duplicate node id: "${node.id}"`);
    nodeIds.add(node.id);

    if (!isKnownNodeType(node.type)) {
      warnings.push(`Node "${node.id}" has an unrecognized type "${node.type}"`);
    }
  }

  const validEdges: WorkflowEdge[] = [];
  for (const edge of edges) {
    const sourceExists = nodeIds.has(edge.source);
    const targetExists = nodeIds.has(edge.target);
    if (!sourceExists) errors.push(`Edge "${edge.id}" references unknown source node "${edge.source}"`);
    if (!targetExists) errors.push(`Edge "${edge.id}" references unknown target node "${edge.target}"`);
    if (sourceExists && targetExists) validEdges.push(edge);
  }

  const triggerCount = nodes.filter((node) => isTriggerNodeType(node.type)).length;
  if (triggerCount !== 1) {
    errors.push(`Workflow must have exactly one trigger node, found ${triggerCount}`);
  }

  try {
    topologicalSort(nodes, validEdges);
  } catch (error) {
    if (!(error instanceof CycleError)) throw error;
    errors.push(error.message);
  }

  const connectedNodeIds = new Set<string>();
  for (const edge of validEdges) {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  }
  for (const node of nodes) {
    if (!isTriggerNodeType(node.type) && !connectedNodeIds.has(node.id)) {
      warnings.push(`Node "${node.id}" (${node.type}) is disconnected from the workflow graph`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
