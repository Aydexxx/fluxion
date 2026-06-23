import type { LlmSettings } from "../types";

export interface LlmRequest {
  prompt: string;
  model?: string;
}

export interface LlmResult {
  provider: LlmSettings["provider"];
  model: string;
  text: string;
}

/**
 * Provider-agnostic LLM call. The provider is chosen by the caller (env default,
 * optionally overridden per node) — nothing here is hardcoded to a single
 * vendor, so adding a provider means adding a branch and its settings.
 *
 *  - `none`   — deterministic stub. No network, no keys; lets the whole engine
 *               (and its tests) run without any AI service.
 *  - `ollama` — local/self-hosted models via Ollama's HTTP API. The dev default.
 *  - `openai` — OpenAI-compatible chat completions. Inert until a key is
 *               configured; key activation is intentionally deferred.
 */
export async function runLlm(
  request: LlmRequest,
  settings: LlmSettings,
  fetchImpl: typeof fetch,
): Promise<LlmResult> {
  switch (settings.provider) {
    case "none":
      return runNone(request);
    case "ollama":
      return runOllama(request, settings, fetchImpl);
    case "openai":
      return runOpenai(request, settings, fetchImpl);
    default: {
      // Exhaustiveness guard: a new provider must be handled above.
      const unreachable: never = settings.provider;
      throw new Error(`Unsupported LLM provider: ${String(unreachable)}`);
    }
  }
}

/**
 * Deterministic stub: same prompt + model always yields the same text, so tests
 * can assert exact output and flows are reproducible offline.
 */
function runNone({ prompt, model }: LlmRequest): LlmResult {
  const resolvedModel = model ?? "stub";
  return {
    provider: "none",
    model: resolvedModel,
    text: `[stub:${resolvedModel}] ${prompt}`,
  };
}

async function runOllama(
  { prompt, model }: LlmRequest,
  settings: LlmSettings,
  fetchImpl: typeof fetch,
): Promise<LlmResult> {
  const resolvedModel = model ?? settings.ollamaModel;
  const res = await fetchImpl(`${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: resolvedModel, prompt, stream: false }),
  });
  if (!res.ok) {
    throw new Error(`Ollama request failed with status ${res.status}`);
  }
  const data = (await res.json()) as { response?: string };
  return { provider: "ollama", model: resolvedModel, text: data.response ?? "" };
}

async function runOpenai(
  { prompt, model }: LlmRequest,
  settings: LlmSettings,
  fetchImpl: typeof fetch,
): Promise<LlmResult> {
  if (!settings.openaiApiKey) {
    throw new Error("OpenAI provider is not configured (missing API key)");
  }
  const resolvedModel = model ?? settings.openaiModel;
  const res = await fetchImpl(`${settings.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiApiKey}`,
    },
    body: JSON.stringify({ model: resolvedModel, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI request failed with status ${res.status}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { provider: "openai", model: resolvedModel, text: data.choices?.[0]?.message?.content ?? "" };
}
