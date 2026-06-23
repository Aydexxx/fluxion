// Wire types mirroring the Fluxion backend (Phase 1 & 2).

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  workspace?: Workspace;
}

/** A node in the workflow DAG. `config` is freeform per node type. */
export interface FlowNodeDef {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface FlowEdgeDef {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDefinition {
  nodes: FlowNodeDef[];
  edges: FlowEdgeDef[];
}

/** Summary shape returned by GET /workflows (no definition). */
export interface WorkflowSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Full shape returned by GET /workflows/:id and POST /workflows. */
export interface Workflow extends WorkflowSummary {
  definition: WorkflowDefinition;
  /** Token for this workflow's inbound webhook URL (/webhooks/:token). */
  webhookToken: string | null;
}

export interface UpdateWorkflowResponse extends Workflow {
  warnings: string[];
}

/* ── Execution / runs (Phase 3) ─────────────────────────────────────────── */

export type ExecutionStatus = "queued" | "running" | "success" | "failed";
export type RunTriggerType = "manual" | "webhook" | "schedule";

/** Per-node result captured during a run. */
export interface NodeExecution {
  id: string;
  nodeId: string;
  status: ExecutionStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Full run returned by POST /workflows/:id/run and GET /runs/:id. */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  trigger: RunTriggerType;
  payload: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nodeExecutions: NodeExecution[];
}

/** Compact run shape from GET /workflows/:id/runs (no node executions). */
export interface RunSummary {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  trigger: RunTriggerType;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}
