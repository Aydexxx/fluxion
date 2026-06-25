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
  /** Optional pinned sample output, persisted with the definition. */
  pinnedData?: unknown;
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

/** A prebuilt example workflow shown in the template gallery (GET /templates). */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Node types used, in first-appearance order, for the card's chips. */
  nodeTypes: string[];
  definition: WorkflowDefinition;
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

/** Workflow-level failure-alert config: notify a channel when a run fails. */
export interface FailureNotifyConfig {
  channel: "slack" | "email";
  credentialId: string;
  /** Recipient address — email only. */
  to?: string;
}

/** Full shape returned by GET /workflows/:id and POST /workflows. */
export interface Workflow extends WorkflowSummary {
  /** The draft — what the editor edits. */
  definition: WorkflowDefinition;
  /** What active webhook/schedule triggers run. Null until first publish. */
  publishedDefinition: WorkflowDefinition | null;
  /** True when the draft differs from what's published. */
  hasUnpublishedChanges: boolean;
  /** Currently-published version number, or null if never published. */
  publishedVersion: number | null;
  /** Failure-alert config, or null when no alerts are configured. */
  failureNotify: FailureNotifyConfig | null;
  /** Token for this workflow's inbound webhook URL (/webhooks/:token). */
  webhookToken: string | null;
}

export interface UpdateWorkflowResponse extends Workflow {
  warnings: string[];
}

/* ── Versioning ─────────────────────────────────────────────────────────── */

/** A single node that differs between two definitions. */
export interface ChangedNode {
  id: string;
  type: string;
  changes: Array<"type" | "config" | "position">;
}

/** A non-visual summary of how one definition differs from another. */
export interface DefinitionDiff {
  addedNodes: Array<{ id: string; type: string }>;
  removedNodes: Array<{ id: string; type: string }>;
  changedNodes: ChangedNode[];
  edgesAdded: number;
  edgesRemoved: number;
  identical: boolean;
}

/** A published version in the history list (GET /workflows/:id/versions). */
export interface WorkflowVersionSummary {
  id: string;
  version: number;
  name: string;
  note: string | null;
  authorName: string | null;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  /** Diff vs the version before it (vs empty for v1). */
  diff: DefinitionDiff;
  /** True for the highest version — the one currently live. */
  isCurrent: boolean;
}

/** A version with its full definition (GET /workflows/:id/versions/:versionId). */
export interface WorkflowVersionDetail extends WorkflowVersionSummary {
  definition: WorkflowDefinition;
}

/** Response from publish + rollback: the updated workflow and the new version. */
export interface PublishResponse {
  workflow: Workflow;
  version: WorkflowVersionSummary;
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
  /** Number of attempts the engine made for this node (>=1). */
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export type RunLogLevel = "debug" | "info" | "warn" | "error";

/** A single structured log line for a run (correlation id = the run id). */
export interface RunLogEntry {
  seq: number;
  ts: string;
  level: RunLogLevel;
  message: string;
  nodeId: string | null;
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

/** Result of testing a single node in isolation (POST /workflows/:id/nodes/:nodeId/test). */
export interface NodeTestResult {
  nodeId: string;
  status: "success" | "failed";
  /** The exact `{ trigger, sources }` fed to the executor. */
  input: { trigger: unknown; sources: Record<string, unknown> };
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/** Run summary enriched with workflow name + replay lineage, from GET /runs. */
export interface WorkspaceRunSummary extends RunSummary {
  workflowName: string;
  createdAt: string | null;
  replayOfId: string | null;
  /** For a failed run, the node that failed (dead-letter culprit). Null otherwise. */
  failingNode: string | null;
}

export interface RunFilters {
  status?: ExecutionStatus;
  workflowId?: string;
  trigger?: RunTriggerType;
  /** Free-text match against workflow name or run id. */
  search?: string;
  from?: string;
  to?: string;
}

/** One page of workspace runs plus the keyset cursor for the next page (infinite scroll). */
export interface WorkspaceRunsPage {
  runs: WorkspaceRunSummary[];
  /** Pass back as `cursor` to fetch the next page; null when there are no more. */
  nextCursor: string | null;
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
