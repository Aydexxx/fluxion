import { describe, expect, it, vi } from "vitest";
import { runAgent } from "../llm/agent";
import { httpGetTool, normalizeKnowledge, ragSearchTool } from "../llm/tools";
import { agentExecutor } from "../executors/aiAgent";
import { stubCredentialAccessor } from "../runWorkflow";
import type { ExecutionContext, LlmSettings } from "../types";
import type { WorkflowNode } from "../../dag/types";

const base: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

const knowledge = normalizeKnowledge([
  { id: "refunds", text: "Refunds are processed within 5 business days." },
  { id: "shipping", text: "Standard shipping takes 3 to 7 days." },
]);

describe("rag_search tool", () => {
  it("returns the best-matching documents deterministically", async () => {
    const tool = ragSearchTool(knowledge);
    expect(await tool.run({ query: "how long do refunds take" })).toBe(
      "[refunds] Refunds are processed within 5 business days.",
    );
  });

  it("returns a stable miss when nothing matches", async () => {
    const tool = ragSearchTool(knowledge);
    expect(await tool.run({ query: "completely unrelated xyzzy" })).toBe("no relevant documents found");
  });
});

describe("http_get tool", () => {
  it("only allows http(s) GETs", async () => {
    const tool = httpGetTool(vi.fn() as unknown as typeof fetch);
    expect(await tool.run({ url: "file:///etc/passwd" })).toMatch(/must start with http/);
  });
});

describe("runAgent — provider 'none' (deterministic stub)", () => {
  it("searches the knowledge once, then answers, with no network", async () => {
    const fetchSpy = vi.fn();
    const result = await runAgent(
      { goal: "When are refunds processed?", tools: [ragSearchTool(knowledge)] },
      base,
      fetchSpy as unknown as typeof fetch,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.provider).toBe("none");
    expect(result.steps).toEqual([
      {
        tool: "rag_search",
        args: { query: "When are refunds processed?" },
        observation: "[refunds] Refunds are processed within 5 business days.",
      },
    ]);
    expect(result.answer).toBe(
      "[agent:none] When are refunds processed? :: [refunds] Refunds are processed within 5 business days.",
    );
  });

  it("answers without tools when none are provided", async () => {
    const result = await runAgent({ goal: "hello" }, base, vi.fn() as unknown as typeof fetch);
    expect(result.steps).toEqual([]);
    expect(result.answer).toBe("[agent:none] hello");
  });
});

describe("runAgent — real provider tool-use loop (text protocol)", () => {
  it("calls a tool then finalizes, driven by the model's TOOL/FINAL lines", async () => {
    // Ollama provider: each LLM call hits /api/generate; we script two replies.
    const replies = ['TOOL rag_search {"query": "refunds"}', "FINAL Refunds take 5 business days."];
    let call = 0;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: replies[call++] }), { status: 200 }));

    const result = await runAgent(
      { goal: "refunds?", tools: [ragSearchTool(knowledge)] },
      { ...base, provider: "ollama" },
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe("rag_search");
    expect(result.steps[0].observation).toMatch(/Refunds are processed/);
    expect(result.answer).toBe("Refunds take 5 business days.");
  });
});

describe("ai.agent executor", () => {
  function ctx(fetchImpl: typeof fetch): ExecutionContext {
    return { workspaceId: "ws", trigger: null, credentials: stubCredentialAccessor, llm: base, fetch: fetchImpl };
  }
  const node = (config: Record<string, unknown>): WorkflowNode => ({ id: "a", type: "ai.agent", position: { x: 0, y: 0 }, config });

  it("runs the deterministic agent with rag knowledge from config", async () => {
    const fetchSpy = vi.fn();
    const output = (await agentExecutor.execute(
      node({ provider: "none", goal: "shipping time?", knowledge: ["Standard shipping takes 3 to 7 days."] }),
      { trigger: null, sources: {} },
      ctx(fetchSpy as unknown as typeof fetch),
    )) as { answer: string; steps: unknown[] };

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.answer).toBe("[agent:none] shipping time? :: [doc1] Standard shipping takes 3 to 7 days.");
  });
});
