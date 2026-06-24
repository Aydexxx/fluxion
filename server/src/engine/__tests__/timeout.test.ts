import { describe, expect, it, vi } from "vitest";
import { TimeoutError, resolveTimeout, withTimeout } from "../timeout";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import type { LlmSettings } from "../types";
import type { WorkflowDefinition } from "../../dag/types";

describe("withTimeout", () => {
  it("resolves when the promise settles before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "x")).resolves.toBe("ok");
  });

  it("rejects with a TimeoutError when the deadline passes", async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 20, "slow op")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("is a no-op passthrough for a non-positive timeout", async () => {
    const p = Promise.resolve(42);
    expect(withTimeout(p, 0, "x")).toBe(p);
  });

  it("resolveTimeout prefers a positive config override, else the fallback", () => {
    expect(resolveTimeout(50, 30_000)).toBe(50);
    expect(resolveTimeout(undefined, 30_000)).toBe(30_000);
    expect(resolveTimeout(0, 30_000)).toBe(30_000);
    expect(resolveTimeout(-5, 30_000)).toBe(30_000);
  });
});

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

async function run(definition: WorkflowDefinition, fetchImpl: typeof fetch): Promise<RunRecord> {
  const recorder = new InMemoryRunRecorder();
  const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: null });
  return runWorkflow({
    runId,
    workflowId: "wf",
    workspaceId: "ws",
    definition,
    trigger: { type: "manual", payload: null },
    registry: createDefaultRegistry(),
    recorder,
    llm,
    fetchImpl,
  });
}

describe("action.http node timeout", () => {
  it("fails the node (and run) when the request exceeds the node timeout", async () => {
    // fetch never settles -> only the timeout can end the node.
    const hangingFetch = vi.fn(() => new Promise<Response>(() => {}));
    const definition: WorkflowDefinition = {
      nodes: [
        { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        { id: "h", type: "action.http", position: { x: 0, y: 0 }, config: { url: "https://hang.test", timeoutMs: 40 } },
      ],
      edges: [{ id: "e1", source: "t", target: "h" }],
    };

    const result = await run(definition, hangingFetch as unknown as typeof fetch);

    expect(result.status).toBe("failed");
    const httpExec = result.nodeExecutions.find((n) => n.nodeId === "h")!;
    expect(httpExec.status).toBe("failed");
    expect(httpExec.error).toMatch(/timed out after 40ms/);
  });
});
