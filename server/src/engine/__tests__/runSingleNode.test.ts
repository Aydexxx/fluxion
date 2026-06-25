import { describe, expect, it, vi } from "vitest";
import { runSingleNode, UnknownNodeError } from "../runSingleNode";
import { createDefaultRegistry } from "../registry";
import type { LlmSettings } from "../types";
import type { WorkflowDefinition, WorkflowNode } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

function node(id: string, type: string, config: Record<string, unknown> = {}, pinnedData?: unknown): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config, ...(pinnedData !== undefined ? { pinnedData } : {}) };
}

const registry = createDefaultRegistry();

function test(definition: WorkflowDefinition, nodeId: string, params: Partial<Parameters<typeof runSingleNode>[0]> = {}) {
  return runSingleNode({ workspaceId: "ws", definition, nodeId, registry, llm, ...params });
}

describe("runSingleNode — reference resolution", () => {
  it("resolves {{ }} references in the node's config against supplied source data", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("shape", "action.transform")],
      edges: [{ id: "e1", source: "t", target: "shape" }],
    };

    const result = await test(definition, "shape", {
      configOverride: { mappings: [{ key: "greeting", value: "Hi {{ input.name }} ({{ input.role }})" }] },
      sources: { t: { name: "Ada", role: "admin" } },
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ greeting: "Hi Ada (admin)" });
  });

  it("forwards a whole upstream object when a config value is a single exact token", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("api", "action.http"), node("out", "output.response", { body: "{{ api.body }}" })],
      edges: [{ id: "e1", source: "api", target: "out" }],
    };

    const result = await test(definition, "out", { sources: { api: { body: { id: 7, ok: true } } } });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ body: { id: 7, ok: true } });
  });

  it("resolves {{ trigger.* }} against the supplied trigger payload", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.webhook"), node("out", "output.response", { body: "id={{ trigger.id }}" })],
      edges: [{ id: "e1", source: "t", target: "out" }],
    };

    const result = await test(definition, "out", { trigger: { id: 99 } });

    expect(result.output).toEqual({ body: "id=99" });
  });

  it("exposes every ancestor by id in scope, not just direct parents", async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node("a", "action.transform"),
        node("b", "action.transform"),
        node("c", "output.response", { body: "{{ a.v }}-{{ b.v }}" }),
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
    };

    const result = await test(definition, "c", { sources: { a: { v: "A" }, b: { v: "B" } } });

    // `a` is a grandparent of `c`, reachable via scope-by-id even though only `b`
    // is a direct parent (and therefore the only entry in input.sources).
    expect(result.output).toEqual({ body: "A-B" });
    expect(result.input.sources).toEqual({ b: { v: "B" } });
  });
});

describe("runSingleNode — pinned data precedence", () => {
  const definition: WorkflowDefinition = {
    nodes: [
      node("api", "action.http", {}, { body: { title: "PINNED" } }),
      node("out", "output.response", { body: "{{ api.body.title }}" }),
    ],
    edges: [{ id: "e1", source: "api", target: "out" }],
  };

  it("uses an ancestor's pinned data over a supplied source", async () => {
    const result = await test(definition, "out", { sources: { api: { body: { title: "LIVE" } } } });
    expect(result.output).toEqual({ body: "PINNED" });
  });

  it("uses pinned data even when no source is supplied for that node", async () => {
    const result = await test(definition, "out", { sources: {} });
    expect(result.output).toEqual({ body: "PINNED" });
  });

  it("falls back to the supplied source when the ancestor has no pinned data", async () => {
    const noPin: WorkflowDefinition = {
      nodes: [node("api", "action.http"), node("out", "output.response", { body: "{{ api.body.title }}" })],
      edges: [{ id: "e1", source: "api", target: "out" }],
    };
    const result = await test(noPin, "out", { sources: { api: { body: { title: "LIVE" } } } });
    expect(result.output).toEqual({ body: "LIVE" });
  });

  it("ignores the target node's own pinned data and actually executes it", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const result = await test(definition, "api", {
      configOverride: { method: "GET", url: "https://example.com" },
      fetchImpl,
    });
    expect(result.status).toBe("success");
    expect((result.output as { status: number }).status).toBe(200);
  });
});

describe("runSingleNode — execution outcome", () => {
  it("captures timing and a failed status when the executor throws", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("api", "action.http", { method: "GET" })],
      edges: [],
    };
    // No url configured → the http executor throws.
    const result = await test(definition, "api");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/url/i);
    expect(typeof result.durationMs).toBe("number");
    expect(result.startedAt).not.toBeNull();
  });

  it("throws UnknownNodeError for a node id not in the definition", async () => {
    const definition: WorkflowDefinition = { nodes: [node("t", "trigger.manual")], edges: [] };
    await expect(test(definition, "ghost")).rejects.toBeInstanceOf(UnknownNodeError);
  });
});
