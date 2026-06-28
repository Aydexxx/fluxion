import type { WorkflowNode } from "../dag/types";

/** Lifecycle status shared by runs and node executions (mirrors the Prisma `ExecutionStatus` enum). */
export type ExecutionStatusValue = "queued" | "running" | "success" | "failed";

/** What kicked off a run (mirrors the Prisma `RunTrigger` enum). */
export type RunTriggerValue = "manual" | "webhook" | "schedule" | "api";

/** A decrypted credential as an executor sees it: its type plus its field values. */
export interface CredentialSecret {
  type: string;
  data: Record<string, string>;
}

/**
 * Resolves a workspace credential by id and decrypts it. The accessor is bound
 * to the run's workspace, so a node can only reach credentials in its own
 * tenant; it returns `null` for an unknown/foreign id. Decryption happens here,
 * inside the worker at execution time — secrets are never handed to the engine
 * any earlier, and never travel to the API/client.
 */
export interface CredentialAccessor {
  resolve(credentialId: string): Promise<CredentialSecret | null>;
}

/**
 * Workspace variables + secrets resolved for a run, as flat `key -> value` maps.
 * `secrets` holds decrypted plaintext — produced only at execution time and used
 * solely to fill the run's template scope; it never travels to the API/client.
 */
export interface ResolvedVariables {
  vars: Record<string, string>;
  secrets: Record<string, string>;
}

/**
 * Loads and decrypts a workspace's variables + secrets for a run. Bound to the
 * run's workspace (so a node can only reach its own tenant's values) and invoked
 * once at run start — decryption happens here, inside the worker (or the
 * single-node tester), exactly like {@link CredentialAccessor}.
 */
export interface VariableResolver {
  resolve(): Promise<ResolvedVariables>;
}

/** SMTP connection + sender details resolved from an `smtp` credential. */
export interface SmtpConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  from?: string;
  secure?: boolean;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  /** Overrides the credential's `from`; falls back to it when omitted. */
  from?: string;
}

export interface EmailSendResult {
  messageId: string;
  accepted: string[];
}

/** Injectable mail transport so the email node can be exercised without a real SMTP server. */
export interface EmailSender {
  send(smtp: SmtpConfig, message: EmailMessage): Promise<EmailSendResult>;
}

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** Injectable database client so the database node can be exercised without a real DB. */
export interface DbQueryRunner {
  query(
    connectionString: string,
    sql: string,
    params: unknown[],
    options: { readOnly: boolean },
  ): Promise<DbQueryResult>;
}

/** Provider-agnostic LLM configuration, resolved from env (and optionally overridden per node). */
export interface LlmSettings {
  provider: "none" | "ollama" | "openai";
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiApiKey?: string;
  openaiModel: string;
}

/**
 * Run-level context handed to every executor. Holds the trigger payload, the
 * owning workspace, a credentials accessor, LLM settings, and an injectable
 * `fetch` so network-touching executors can be mocked in tests.
 */
/** Run-level default time budgets for network-touching nodes (overridable per node). */
export interface NodeLimits {
  httpTimeoutMs: number;
  aiTimeoutMs: number;
}

/** One invocation of a sub-workflow by a `flow.subworkflow` node. */
export interface SubworkflowInvocation {
  /** The calling `flow.subworkflow` node's id in the parent definition (for run linkage). */
  callerNodeId: string;
  /** Id of the target workflow to run (must live in the parent run's workspace). */
  targetWorkflowId: string;
  /** Data mapped into the sub-workflow — becomes its trigger payload. */
  input: unknown;
}

/** Result of a nested sub-workflow run, returned to the calling node. */
export interface SubworkflowRunResult {
  /** The nested run's id, linked to the parent run for traceability. */
  runId: string;
  status: "success" | "failed";
  /** The sub-workflow's resolved output (its Response node's body, or terminal output). */
  output: unknown;
  error: string | null;
}

/**
 * Executes a sub-workflow as a nested run. Wired by the worker (and recursively
 * by the runner itself), carrying the call-chain context — depth + ancestor
 * workflow ids — so it can enforce a max nesting depth and reject cycles. Absent
 * in single-node tests, where a `flow.subworkflow` node has nothing to run into.
 */
export interface SubworkflowRunner {
  run(invocation: SubworkflowInvocation): Promise<SubworkflowRunResult>;
}

export interface ExecutionContext {
  workspaceId: string;
  trigger: unknown;
  credentials: CredentialAccessor;
  llm: LlmSettings;
  fetch: typeof fetch;
  /** Mail transport for the email node; defaults to a real SMTP sender in the worker. */
  email?: EmailSender;
  /** Database client for the database node; defaults to a real Postgres runner in the worker. */
  db?: DbQueryRunner;
  /** Default per-node timeouts; a node's own `config.timeoutMs` overrides these. */
  limits?: NodeLimits;
  /** Runs nested sub-workflows for the `flow.subworkflow` node. Absent in single-node tests. */
  subworkflows?: SubworkflowRunner;
}

/**
 * The input assembled for a node before it executes: the run's trigger payload
 * plus the outputs of its upstream (source) nodes, keyed by source node id.
 */
export interface NodeInput {
  trigger: unknown;
  sources: Record<string, unknown>;
}

/**
 * A single, pluggable node implementation. Adding a new node type to the
 * platform is exactly this: implement `execute` and register it.
 *
 * `node.config` is already template-resolved by the orchestrator before
 * `execute` is called, so executors read concrete values, not `{{...}}` strings.
 */
export interface NodeExecutor {
  readonly type: string;
  execute(node: WorkflowNode, input: NodeInput, context: ExecutionContext): Promise<unknown>;
}
