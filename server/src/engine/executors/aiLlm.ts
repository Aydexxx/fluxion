import type { NodeExecutor } from "../types";
import type { LlmSettings } from "../types";
import { runLlm } from "../llm/provider";

interface LlmNodeConfig {
  prompt?: string;
  model?: string;
  provider?: LlmSettings["provider"];
}

/**
 * Calls an LLM through the provider-agnostic layer. The provider comes from the
 * run's LLM settings (env-driven, dev default `ollama`) but can be overridden
 * per node via `config.provider` — handy for pinning a node to the `none` stub
 * so it stays deterministic and offline regardless of environment.
 */
export const llmExecutor: NodeExecutor = {
  type: "ai.llm",
  async execute(node, _input, context) {
    const config = node.config as LlmNodeConfig;
    const prompt = typeof config.prompt === "string" ? config.prompt : "";

    const settings: LlmSettings = config.provider
      ? { ...context.llm, provider: config.provider }
      : context.llm;

    return runLlm({ prompt, model: config.model }, settings, context.fetch);
  },
};
