import type { WorkflowNode } from "../dag/types";

/** Lifecycle status shared by runs and node executions (mirrors the Prisma `ExecutionStatus` enum). */
export type ExecutionStatusValue = "queued" | "running" | "success" | "failed";

/** What kicked off a run (mirrors the Prisma `RunTrigger` enum). */
export type RunTriggerValue = "manual" | "webhook" | "schedule";

/**
 * Read-only accessor for workspace credentials. Real decryption is wired in a
 * later phase; for now this is a stub so executors can depend on the interface
 * without the secret store existing yet.
 */
export interface CredentialAccessor {
  get(name: string): Promise<string | null>;
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
export interface ExecutionContext {
  workspaceId: string;
  trigger: unknown;
  credentials: CredentialAccessor;
  llm: LlmSettings;
  fetch: typeof fetch;
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
