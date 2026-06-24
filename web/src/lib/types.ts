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
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Origin run id when this run is a replay, else null. */
  replayOfId: string | null;
  nodeExecutions: NodeExecution[];
}

/* ── Credentials (encrypted vault) ──────────────────────────────────────── */

export interface CredentialFieldSpec {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
  placeholder?: string;
}

/** A credential type and its field schema, from GET /credentials/types. */
export interface CredentialTypeSpec {
  type: string;
  label: string;
  blurb: string;
  fields: CredentialFieldSpec[];
  previewKey: string | null;
}

/** Client-safe credential metadata — never includes secret values. */
export interface Credential {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  /** Non-secret field values (e.g. SMTP host), safe to display and pre-fill. */
  meta: Record<string, string>;
  /** Last 4 chars of the primary secret, or null. */
  last4: string | null;
  createdAt: string;
  updatedAt: string;
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

/** Run summary enriched with workflow name + replay lineage, from GET /runs. */
export interface WorkspaceRunSummary extends RunSummary {
  workflowName: string;
  createdAt: string | null;
  replayOfId: string | null;
}

export interface RunFilters {
  status?: ExecutionStatus;
  workflowId?: string;
  from?: string;
  to?: string;
}

/* ── Analytics ──────────────────────────────────────────────────────────── */

export interface AnalyticsSummary {
  total: number;
  success: number;
  failed: number;
  running: number;
  queued: number;
  successRate: number;
  avgDurationMs: number;
}

export interface RunsOverTimePoint {
  date: string;
  success: number;
  failed: number;
  total: number;
}

export interface FailingWorkflow {
  workflowId: string;
  name: string;
  failures: number;
  total: number;
}

export interface FailingNode {
  workflowId: string;
  workflowName: string;
  nodeId: string;
  failures: number;
}

export interface AnalyticsResult {
  range: { from: string; to: string };
  summary: AnalyticsSummary;
  runsOverTime: RunsOverTimePoint[];
  topFailingWorkflows: FailingWorkflow[];
  topFailingNodes: FailingNode[];
}
