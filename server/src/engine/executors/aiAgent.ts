import type { LlmSettings, NodeExecutor } from "../types";
import { runAgent } from "../llm/agent";
import { httpGetTool, normalizeKnowledge, ragSearchTool, type AgentTool } from "../llm/tools";
import { resolveTimeout, withTimeout } from "../timeout";

const DEFAULT_AGENT_TIMEOUT_MS = 60_000;

interface AgentNodeConfig {
  goal?: string;
  /** Back-compat alias for `goal`, matching the ai.llm node's field name. */
  prompt?: string;
  model?: string;
  provider?: LlmSettings["provider"];
  maxSteps?: number;
  /** Which tools to enable; defaults to just rag_search (offline + safe). */
  tools?: string[];
  knowledge?: unknown;
  /** Per-node timeout override (ms) for the whole agent loop. */
  timeoutMs?: number;
}

/**
 * Agentic AI node: an LLM with tool use. It reasons toward the configured goal,
 * optionally calling a small, safe tool set (knowledge search and a read-only
 * HTTP GET) in a loop before producing a final answer. Provider comes from the
 * run's LLM settings but can be pinned per node (e.g. to `none` for a fully
 * deterministic, offline agent).
 */
export const agentExecutor: NodeExecutor = {
  type: "ai.agent",
  async execute(node, _input, context) {
    const config = node.config as AgentNodeConfig;
    const goal = (config.goal ?? config.prompt ?? "").toString();

    const settings: LlmSettings = config.provider ? { ...context.llm, provider: config.provider } : context.llm;

    const enabled = new Set(Array.isArray(config.tools) && config.tools.length > 0 ? config.tools : ["rag_search"]);
    const tools: AgentTool[] = [];
    if (enabled.has("rag_search")) tools.push(ragSearchTool(normalizeKnowledge(config.knowledge)));
    if (enabled.has("http_get")) tools.push(httpGetTool(context.fetch));

    const timeoutMs = resolveTimeout(config.timeoutMs, context.limits?.aiTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS);
    return withTimeout(
      runAgent(
        { goal, model: config.model, maxSteps: typeof config.maxSteps === "number" ? config.maxSteps : undefined, tools },
        settings,
        context.fetch,
      ),
      timeoutMs,
      "AI agent node",
    );
  },
};
