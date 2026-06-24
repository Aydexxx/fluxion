import type { LlmSettings } from "../types";
import { runLlm } from "./provider";
import type { AgentTool } from "./tools";

/**
 * Provider-agnostic agentic loop: an LLM that reasons over a goal and may call
 * tools (in a loop) before committing to a final answer.
 *
 * The model speaks a tiny line protocol so the same loop works over any
 * single-prompt provider (`runLlm`) without provider-specific tool-calling
 * wire formats:
 *   - `TOOL <name> <json-args>` — invoke a tool; its observation is fed back in.
 *   - `FINAL <answer>`          — stop with this answer.
 *
 * Provider `none` runs a deterministic controller instead (RAG-search once,
 * then answer), so the node is fully reproducible and offline in tests.
 */

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  observation: string;
}

export interface AgentResult {
  provider: LlmSettings["provider"];
  model: string;
  answer: string;
  steps: AgentStep[];
}

export interface AgentRequest {
  goal: string;
  model?: string;
  maxSteps?: number;
  tools?: AgentTool[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function resolveModel(request: AgentRequest, settings: LlmSettings): string {
  if (request.model) return request.model;
  if (settings.provider === "openai") return settings.openaiModel;
  if (settings.provider === "ollama") return settings.ollamaModel;
  return "stub";
}

export async function runAgent(
  request: AgentRequest,
  settings: LlmSettings,
  fetchImpl: typeof fetch,
): Promise<AgentResult> {
  const model = resolveModel(request, settings);
  const maxSteps = clamp(request.maxSteps ?? 4, 1, 8);
  const tools = request.tools ?? [];
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const steps: AgentStep[] = [];

  if (settings.provider === "none") {
    return runStubAgent(request, model, toolByName);
  }

  let transcript = preamble(request);
  for (let i = 0; i < maxSteps; i++) {
    const { text } = await runLlm({ prompt: transcript, model }, settings, fetchImpl);
    const action = parseAction(text);
    if (action.kind === "final") {
      return { provider: settings.provider, model, answer: action.answer, steps };
    }
    const tool = toolByName.get(action.name);
    const observation = tool ? await tool.run(action.args) : `error: unknown tool "${action.name}"`;
    steps.push({ tool: action.name, args: action.args, observation });
    transcript += `\nTOOL ${action.name} ${JSON.stringify(action.args)}\nOBSERVATION ${observation}\n`;
  }
  return { provider: settings.provider, model, answer: "Agent stopped: step budget exhausted", steps };
}

/** Deterministic controller for provider `none`: search the knowledge once, then answer. */
async function runStubAgent(
  request: AgentRequest,
  model: string,
  toolByName: Map<string, AgentTool>,
): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const rag = toolByName.get("rag_search");
  let observation = "";
  if (rag) {
    observation = await rag.run({ query: request.goal });
    steps.push({ tool: "rag_search", args: { query: request.goal }, observation });
  }
  const answer = observation ? `[agent:none] ${request.goal} :: ${observation}` : `[agent:none] ${request.goal}`;
  return { provider: "none", model, answer, steps };
}

function preamble(request: AgentRequest): string {
  const toolList = (request.tools ?? []).map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return [
    "You are a task-solving agent. Use tools when helpful, then give a final answer.",
    "Respond with exactly ONE line, either:",
    "  TOOL <name> <json-args>",
    "  FINAL <answer>",
    "",
    "Tools:",
    toolList || "(none)",
    "",
    `Goal: ${request.goal}`,
  ].join("\n");
}

type Action = { kind: "final"; answer: string } | { kind: "tool"; name: string; args: Record<string, unknown> };

/** Parses one protocol line out of the model's reply, tolerating extra surrounding text. */
function parseAction(text: string): Action {
  const trimmed = text.trim();
  const finalMatch = trimmed.match(/FINAL\s+([\s\S]*)/i);
  const toolMatch = trimmed.match(/TOOL\s+(\S+)\s*(\{[\s\S]*\})?/i);

  // Whichever directive appears first wins; default to treating the reply as a final answer.
  const finalIdx = finalMatch ? trimmed.toUpperCase().indexOf("FINAL") : Infinity;
  const toolIdx = toolMatch ? trimmed.toUpperCase().indexOf("TOOL") : Infinity;

  if (toolMatch && toolIdx < finalIdx) {
    let args: Record<string, unknown> = {};
    if (toolMatch[2]) {
      try {
        args = JSON.parse(toolMatch[2]) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    return { kind: "tool", name: toolMatch[1], args };
  }
  if (finalMatch) return { kind: "final", answer: finalMatch[1].trim() };
  return { kind: "final", answer: trimmed };
}
