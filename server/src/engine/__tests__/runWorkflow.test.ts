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

interface RunOptions {
  payload?: unknown;
  fetchImpl?: typeof fetch;
}

async function run(definition: WorkflowDefinition, options: RunOptions = {}): Promise<RunRecord> {
  const recorder = new InMemoryRunRecorder();
  const runId = await recorder.enqueueRun({ workflowId: "wf_test", trigger: "manual", payload: options.payload ?? null });
  return runWorkflow({
    runId,
    workflowId: "wf_test",
    workspaceId: "ws_test",
    definition,
    trigger: { type: "manual", payload: options.payload ?? null },
    registry: createDefaultRegistry(),
    recorder,
    llm,
    fetchImpl: options.fetchImpl,
  });
}

const nodeIds = (run: RunRecord) => run.nodeExecutions.map((n) => n.nodeId);
const outputOf = (run: RunRecord, id: string) => run.nodeExecutions.find((n) => n.nodeId === id)?.output;

describe("runWorkflow — ordering", () => {
  it("executes nodes in topological order", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("out", "output.response"),
        node("t", "trigger.manual"),
        node("x", "action.transform"),
      ],
      edges: [edge("e1", "t", "x"), edge("e2", "x", "out")],
    };

    const result = await run(definition);

    expect(result.status).toBe("success");
    expect(nodeIds(result)).toEqual(["t", "x", "out"]);
  });

  it("merges outputs of multiple upstream nodes into a node's input.sources", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("a", "action.transform", { mappings: { v: "A" } }),
        node("b", "action.transform", { mappings: { v: "B" } }),
        node("merge", "output.response", { body: "{{a.v}}+{{b.v}}" }),
      ],
      edges: [
        edge("e1", "t", "a"),
        edge("e2", "t", "b"),
        edge("e3", "a", "merge"),
        edge("e4", "b", "merge"),
      ],
    };

    const result = await run(definition);
    const mergeExec = result.nodeExecutions.find((n) => n.nodeId === "merge")!;
    expect(mergeExec.input).toEqual({
      trigger: null,
      sources: { a: { v: "A" }, b: { v: "B" } },
    });
    expect(outputOf(result, "merge")).toEqual({ body: "A+B" });
  });
});

describe("runWorkflow — data passing / templating", () => {
  it("passes the trigger payload through and references it downstream", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("x", "action.transform", { mappings: { greeting: "Hi {{trigger.name}}" } }),
        node("out", "output.response", { body: "{{x.greeting}}!" }),
      ],
      edges: [edge("e1", "t", "x"), edge("e2", "x", "out")],
    };

    const result = await run(definition, { payload: { name: "Ada" } });

    expect(outputOf(result, "t")).toEqual({ name: "Ada" });
    expect(outputOf(result, "x")).toEqual({ greeting: "Hi Ada" });
    expect(outputOf(result, "out")).toEqual({ body: "Hi Ada!" });
  });
});

describe("runWorkflow — action.http (mocked)", () => {
  it("makes the request from resolved config and captures status + body", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "u1" }), { status: 201, headers: { "content-type": "application/json" } }),
    );

    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("http", "action.http", {
          method: "POST",
          url: "https://api.test/users/{{trigger.userId}}",
          headers: { "X-Trace": "{{trigger.userId}}" },
          body: { name: "Ada" },
        }),
      ],
      edges: [edge("e1", "t", "http")],
    };

    const result = await run(definition, { payload: { userId: "42" }, fetchImpl: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/users/42");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "X-Trace": "42", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });
    expect(outputOf(result, "http")).toMatchObject({ status: 201, body: { id: "u1" } });
    expect(result.status).toBe("success");
  });
});

describe("runWorkflow — condition gating", () => {
  it("runs only the matching branch and skips the other (no execution row)", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("cond", "logic.condition", { expression: "{{trigger.status}} == 200" }),
        node("ok", "output.response", { body: "ok" }),
        node("fail", "output.response", { body: "fail" }),
      ],
      edges: [
        edge("e1", "t", "cond"),
        edge("e2", "cond", "ok", "true"),
        edge("e3", "cond", "fail", "false"),
      ],
    };

    const result = await run(definition, { payload: { status: 200 } });

    expect(outputOf(result, "cond")).toEqual({ result: true, branch: "true" });
    expect(nodeIds(result)).toEqual(["t", "cond", "ok"]);
    expect(result.nodeExecutions.find((n) => n.nodeId === "fail")).toBeUndefined();
    expect(result.status).toBe("success");
  });

  it("skips a node whose only upstream took the other branch (cascade)", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("cond", "logic.condition", { expression: "{{trigger.status}} == 200" }),
        node("fail", "output.response", { body: "fail" }),
        node("after", "output.response", { body: "after-fail" }),
      ],
      edges: [
        edge("e1", "t", "cond"),
        edge("e2", "cond", "fail", "false"),
        edge("e3", "fail", "after"),
      ],
    };

    const result = await run(definition, { payload: { status: 200 } });

    expect(nodeIds(result)).toEqual(["t", "cond"]);
    expect(result.status).toBe("success");
  });
});

describe("runWorkflow — ai.llm with provider 'none'", () => {
  it("produces a deterministic stub output without any network call", async () => {
    const fetchMock = vi.fn();
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("ai", "ai.llm", { provider: "none", model: "m1", prompt: "Summarize {{trigger.text}}" }),
      ],
      edges: [edge("e1", "t", "ai")],
    };

    const result = await run(definition, { payload: { text: "the news" }, fetchImpl: fetchMock as unknown as typeof fetch });

    expect(outputOf(result, "ai")).toEqual({ provider: "none", model: "m1", text: "[stub:m1] Summarize the news" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runWorkflow — failure handling (fail-fast)", () => {
  it("marks the failing node and the run failed, and stops executing downstream nodes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });

    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("http", "action.http", { url: "https://down.test" }),
        node("after", "output.response", { body: "never" }),
      ],
      edges: [edge("e1", "t", "http"), edge("e2", "http", "after")],
    };

    const result = await run(definition, { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/http.*connection refused/i);
    const httpExec = result.nodeExecutions.find((n) => n.nodeId === "http")!;
    expect(httpExec.status).toBe("failed");
    expect(httpExec.error).toMatch(/connection refused/);
    expect(result.nodeExecutions.find((n) => n.nodeId === "after")).toBeUndefined();
  });

  it("fails the run when a node type has no registered executor", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("mystery", "does.not.exist")],
      edges: [edge("e1", "t", "mystery")],
    };

    const result = await run(definition);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/No executor registered/);
  });
});

describe("runWorkflow — editor-shaped configs", () => {
  it("transform accepts the editor's [{key,value}] mapping rows and resolves the {{input}} alias", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("x", "action.transform", { mappings: [{ key: "topic", value: "{{ input.subject }}" }, { key: "", value: "skip" }] }),
      ],
      edges: [edge("e1", "t", "x")],
    };

    const result = await run(definition, { payload: { subject: "weather" } });
    // single upstream -> `input` aliases the trigger output; empty-key row dropped
    expect(outputOf(result, "x")).toEqual({ topic: "weather" });
  });

  it("http accepts a multiline 'Key: Value' headers string and resolves templates in it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("http", "action.http", {
          method: "POST",
          url: "https://api.test/x",
          headers: "X-Static: 1\nX-Trace: {{ input.id }}",
          body: "hello",
        }),
      ],
      edges: [edge("e1", "t", "http")],
    };

    await run(definition, { payload: { id: "abc" }, fetchImpl: fetchMock as unknown as typeof fetch });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Static": "1", "X-Trace": "abc" });
    expect(init.body).toBe("hello");
  });

  it("the {{input}} alias becomes the source map when a node has multiple upstreams", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("a", "action.transform", { mappings: { v: "A" } }),
        node("b", "action.transform", { mappings: { v: "B" } }),
        node("out", "output.response", { body: "{{ input }}" }),
      ],
      edges: [edge("e1", "t", "a"), edge("e2", "t", "b"), edge("e3", "a", "out"), edge("e4", "b", "out")],
    };

    const result = await run(definition);
    // two upstreams -> input is the { nodeId: output } map; `{{ input }}` is a
    // single exact token, so the object is forwarded with its type preserved.
    expect(outputOf(result, "out")).toEqual({ body: { a: { v: "A" }, b: { v: "B" } } });
  });
});

describe("runWorkflow — persistence shape", () => {
  it("records status, timing, input and output for the run and each node", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("out", "output.response", { body: "done" })],
      edges: [edge("e1", "t", "out")],
    };

    const result = await run(definition, { payload: { hello: "world" } });

    expect(result.status).toBe("success");
    expect(result.trigger).toBe("manual");
    expect(result.payload).toEqual({ hello: "world" });
    expect(result.startedAt).not.toBeNull();
    expect(result.finishedAt).not.toBeNull();
    expect(result.error).toBeNull();

    for (const exec of result.nodeExecutions) {
      expect(exec.status).toBe("success");
      expect(exec.startedAt).not.toBeNull();
      expect(exec.finishedAt).not.toBeNull();
      expect(exec.input).toMatchObject({ trigger: { hello: "world" } });
    }
    expect(outputOf(result, "out")).toEqual({ body: "done" });
  });
});
