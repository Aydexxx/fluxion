import type { NodeExecutor } from "../types";
import { resolveCredential } from "./credentialUtil";
import { resolveTimeout, withTimeout } from "../timeout";

const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAiConfig {
  credentialId?: string;
  model?: string;
  prompt?: string;
  /** Optional system message, sent ahead of the user prompt. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Per-node timeout override (ms). */
  timeoutMs?: number;
}

export interface OpenAiOutput {
  model: string;
  text: string;
  /** True when no credential was configured — a deterministic offline stub, not a real call. */
  stubbed?: true;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Calls the OpenAI Chat Completions API directly — distinct from the
 * provider-agnostic `ai.llm` node, which goes through the run's env-configured
 * provider. This node is OpenAI-only: it always reads its key from an `openai`
 * credential (never an env default) and exposes OpenAI-specific knobs
 * (temperature, max tokens, token usage).
 *
 * With no credential configured, it returns a deterministic offline stub
 * (mirroring `ai.llm`'s `none` provider) so a workflow can be authored and
 * tested before a real key exists — wiring a credential is what switches it to
 * making real calls.
 */
export const openaiExecutor: NodeExecutor = {
  type: "ai.openai",
  async execute(node, _input, context): Promise<OpenAiOutput> {
    const config = node.config as OpenAiConfig;
    const prompt = typeof config.prompt === "string" ? config.prompt : "";
    const model = config.model?.trim() || DEFAULT_MODEL;

    if (!config.credentialId) {
      return { model, text: `[stub:${model}] ${prompt}`, stubbed: true, usage: null };
    }

    const { data } = await resolveCredential(context, config.credentialId, "openai");
    if (!data.apiKey) throw new Error("openai credential is missing its apiKey");
    const baseUrl = (data.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");

    const messages = [
      ...(config.system?.trim() ? [{ role: "system", content: config.system.trim() }] : []),
      { role: "user", content: prompt },
    ];

    const timeoutMs = resolveTimeout(config.timeoutMs, context.limits?.aiTimeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await withTimeout(
        context.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            ...(typeof config.temperature === "number" ? { temperature: config.temperature } : {}),
            ...(typeof config.maxTokens === "number" ? { max_tokens: config.maxTokens } : {}),
          }),
          signal: controller.signal,
        }),
        timeoutMs,
        "OpenAI node",
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI request failed with status ${res.status}: ${extractErrorMessage(text)}`);
    }

    const parsed = parseJson<ChatCompletionResponse>(text, "OpenAI response was not valid JSON");
    const usage = parsed.usage
      ? {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
          totalTokens: parsed.usage.total_tokens ?? 0,
        }
      : null;

    return { model, text: parsed.choices?.[0]?.message?.content ?? "", usage };
  },
};

function parseJson<T>(text: string, errorMessage: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(errorMessage);
  }
}

/** OpenAI errors come back as `{ error: { message } }`; fall back to a truncated raw body. */
function extractErrorMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON — fall through to the raw text
  }
  return text.slice(0, 300);
}
