// Wire types mirroring the Fluxion backend (Phase 1 & 2).

/** Where the user lands after signing in. */
export type DefaultLanding = "workflows" | "templates" | "runs" | "analytics";

export interface UserPreferences {
  defaultLanding?: DefaultLanding;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  preferences: UserPreferences;
  createdAt: string;
}

/** RBAC roles, in ascending privilege. */
export type WorkspaceRole = "viewer" | "editor" | "admin" | "owner";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  /** The current user's role in this workspace (drives client-side gating). */
  role: WorkspaceRole;
}

export interface AuthResponse {
  token: string;
  user: User;
  workspace?: Workspace;
}

/** A confirmed member of a workspace (members management screen). */
export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
}

/** A pending invite, as seen on the members management screen. */
export interface PendingInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedByName: string | null;
  createdAt: string;
}

export interface WorkspaceMembers {
  members: WorkspaceMember[];
  invites: PendingInvite[];
}

/** An invite as seen by its recipient. */
export interface MyInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  invitedByName: string | null;
  createdAt: string;
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
  /** "builtin" for the seeded catalog, "custom" for user-created workspace templates. */
  kind: "builtin" | "custom";
}

/** A user-created, workspace-scoped template (GET /templates/custom). */
export interface UserTemplate extends TemplateSummary {
  kind: "custom";
  workspaceId: string;
  createdByName: string | null;
  createdAt: string;
}

/** A flat (non-nested) grouping of workflows within a workspace. */
export interface Folder {
  id: string;
  workspaceId: string;
  name: string;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A reusable, workspace-scoped label (names are stored lowercase). */
export interface Tag {
  id: string;
  name: string;
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
  folder: { id: string; name: string } | null;
  tags: Tag[];
}

export type WorkflowSortBy = "updatedAt" | "createdAt" | "name";
export type SortDir = "asc" | "desc";

/** Query params accepted by GET /workflows (server does the filtering/sorting). */
export interface ListWorkflowsParams {
  search?: string;
  /** A folder id, or the literal "none" for unfiled workflows. */
  folderId?: string;
  tagId?: string;
  isActive?: boolean;
  sortBy?: WorkflowSortBy;
  sortDir?: SortDir;
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
export type RunTriggerType = "manual" | "webhook" | "schedule" | "api";

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

/** A nested sub-workflow run spawned by a `flow.subworkflow` node in this run. */
export interface NestedRunRef {
  id: string;
  /** The Call Workflow node in this run that spawned the nested run. */
  parentNodeId: string | null;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  error: string | null;
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
  /** Parent run id when this run is itself a nested sub-workflow run, else null. */
  parentRunId?: string | null;
  /** Back-reference to the parent run when nested (from GET /runs/:id). */
  parentRun?: { id: string; workflowId: string; workflowName: string } | null;
  /** Sub-workflow runs this run spawned, keyed to their calling node (from GET /runs/:id). */
  childRuns?: NestedRunRef[];
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

/** A reusable workspace variable (plain value), referenced via `{{ vars.KEY }}`. */
export interface WorkspaceVariable {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

/** A reusable workspace secret, referenced via `{{ secrets.KEY }}`. The value is
 *  never returned by the API — only its key is exposed. */
export interface WorkspaceSecret {
  id: string;
  key: string;
  createdAt: string;
  updatedAt: string;
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

/* ── Notifications ──────────────────────────────────────────────────────── */

export type NotificationType = "workspace.invited" | "run.failed" | "role.changed" | "mention";

/** A persisted in-app notification (the bell). `data` carries deep-link context. */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  workspaceId: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

/** One page of notifications plus the unread count + keyset cursor. */
export interface NotificationsPage {
  notifications: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
}

/* ── API keys (programmatic access) ─────────────────────────────────────── */

/** The capability scopes an API key can carry (mirrors the server's API_SCOPES). */
export type ApiScope = "workflows:read" | "workflows:run";

/** Client-safe view of an API key — never includes the secret or its hash. */
export interface ApiKey {
  id: string;
  name: string;
  /** Non-secret display slice (e.g. "flux_AbC123"). */
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** A freshly-created key — the only time the full `key` is ever returned. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

/* ── Audit log ──────────────────────────────────────────────────────────── */

/** A single audit entry (who did what to what, when). */
export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** A distinct actor in a workspace's audit log (for the filter dropdown). */
export interface AuditActor {
  id: string;
  name: string;
}

/** One page of audit entries plus the known actors + keyset cursor. */
export interface AuditLogPage {
  entries: AuditLogEntry[];
  actors: AuditActor[];
  nextCursor: string | null;
}

export interface AuditLogFilters {
  actorId?: string;
  action?: string;
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
