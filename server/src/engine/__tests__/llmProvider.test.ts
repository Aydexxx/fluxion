import { describe, expect, it, vi } from "vitest";
import { runLlm } from "../llm/provider";
import type { LlmSettings } from "../types";

const base: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

describe("runLlm — provider 'none'", () => {
  it("returns a deterministic stub without any network call", async () => {
    const fetchSpy = vi.fn();
    const result = await runLlm({ prompt: "Summarize this", model: "test-model" }, base, fetchSpy as unknown as typeof fetch);

    expect(result).toEqual({ provider: "none", model: "test-model", text: "[stub:test-model] Summarize this" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is reproducible for the same input", async () => {
    const a = await runLlm({ prompt: "hi" }, base, vi.fn() as unknown as typeof fetch);
    const b = await runLlm({ prompt: "hi" }, base, vi.fn() as unknown as typeof fetch);
    expect(a).toEqual(b);
  });
});

describe("runLlm — provider 'ollama'", () => {
  it("posts to the ollama generate endpoint and returns the response text", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: "hello from ollama" }), { status: 200 }));
    const result = await runLlm(
      { prompt: "hi" },
      { ...base, provider: "ollama" },
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ provider: "ollama", model: "llama3", text: "hello from ollama" });
  });
});

describe("runLlm — provider 'openai'", () => {
  it("throws when no API key is configured (activation deferred)", async () => {
    await expect(
      runLlm({ prompt: "hi" }, { ...base, provider: "openai" }, vi.fn() as unknown as typeof fetch),
    ).rejects.toThrow(/not configured/i);
  });

  it("calls chat completions when a key is present", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "openai says hi" } }] }), { status: 200 }),
    );
    const result = await runLlm(
      { prompt: "hi" },
      { ...base, provider: "openai", openaiApiKey: "sk-test" },
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
    expect(result.text).toBe("openai says hi");
  });
});
