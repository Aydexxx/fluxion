import { describe, expect, it, vi } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import type { LlmSettings } from "../types";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config };
}

function edge(id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return { id, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

async function run(definition: WorkflowDefinition, fetchImpl?: typeof fetch): Promise<RunRecord> {
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

const ran = (r: RunRecord, id: string) => r.nodeExecutions.some((n) => n.nodeId === id);
const execOf = (r: RunRecord, id: string) => r.nodeExecutions.find((n) => n.nodeId === id);

/** trigger → x(http, may fail) ─normal→ s, ─error→ e. `x`'s on-error policy varies per test. */
function tryCatchGraph(onError: string | undefined): WorkflowDefinition {
  return {
    nodes: [
      node("t", "trigger.manual"),
      node("x", "action.http", { url: "https://x.test", ...(onError ? { onError } : {}) }),
      node("s", "output.response", { body: "success-path" }),
      node("e", "output.response", { body: "caught: {{x.error}}" }),
    ],
    edges: [edge("e1", "t", "x"), edge("e2", "x", "s"), edge("e3", "x", "e", "error")],
  };
}

const throwingFetch = vi.fn(async () => {
  throw new Error("boom");
}) as unknown as typeof fetch;

const okFetch = () =>
  vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("on-error policy: stop (default)", () => {
  it("fails the run and halts downstream when a node errors", async () => {
    const result = await run(tryCatchGraph(undefined), throwingFetch);

    expect(result.status).toBe("failed");
    expect(execOf(result, "x")!.status).toBe("failed");
    expect(result.error).toMatch(/x.*boom/i);
    // Neither the success nor the error path runs.
    expect(ran(result, "s")).toBe(false);
    expect(ran(result, "e")).toBe(false);
  });
});

describe("on-error policy: continue", () => {
  it("swallows the failure and proceeds down the normal edge", async () => {
    const result = await run(tryCatchGraph("continue"), throwingFetch);

    expect(result.status).toBe("success"); // handled — the run is not failed
    expect(execOf(result, "x")!.status).toBe("failed"); // the node still records its failure
    expect(ran(result, "s")).toBe(true); // normal edge fires
    expect(ran(result, "e")).toBe(false); // error edge does NOT fire on continue
  });
});

describe("on-error policy: route", () => {
  it("catches the failure and runs only the error path, exposing the error", async () => {
    const result = await run(tryCatchGraph("route"), throwingFetch);

    expect(result.status).toBe("success"); // caught
    expect(execOf(result, "x")!.status).toBe("failed");
    expect(ran(result, "s")).toBe(false); // normal edge is dead when routed to error
    expect(ran(result, "e")).toBe(true); // error path fires
    expect(execOf(result, "e")!.output).toEqual({ body: "caught: boom" }); // error is readable downstream
  });
});

describe("error-path edges only fire on error", () => {
  it("runs the normal path and skips the error path when the node succeeds", async () => {
    const result = await run(tryCatchGraph("route"), okFetch());

    expect(result.status).toBe("success");
    expect(execOf(result, "x")!.status).toBe("success");
    expect(ran(result, "s")).toBe(true); // success path fires
    expect(ran(result, "e")).toBe(false); // error path stays dead on success
  });
});

describe("per-node retry overrides the global queue default", () => {
  it("re-invokes a failing node up to maxAttempts within a single run", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("transient");
    });
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("x", "action.http", { url: "https://x.test", retry: { maxAttempts: 3 } })],
      edges: [edge("e1", "t", "x")],
    };

    const result = await run(definition, fetchMock as unknown as typeof fetch);

    // 3 attempts in one run — not one attempt deferred to a whole-run queue retry.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("failed");
    expect(execOf(result, "x")!.status).toBe("failed");
  });

  it("succeeds without failing the run when a retry attempt recovers", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("first attempt fails");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("x", "action.http", { url: "https://x.test", retry: { maxAttempts: 3 } })],
      edges: [edge("e1", "t", "x")],
    };

    const result = await run(definition, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(2); // recovered on the 2nd attempt
    expect(result.status).toBe("success");
    expect(execOf(result, "x")!.status).toBe("success");
  });
});
