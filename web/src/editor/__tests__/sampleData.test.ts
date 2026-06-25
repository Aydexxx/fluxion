import { describe, expect, it } from "vitest";
import { buildSampleScope, lastRunSources } from "../sampleData";
import type { FluxEdge, FluxNode } from "../graph";
import type { WorkflowRun } from "../../lib/types";

function node(id: string, nodeType: string, pinned?: unknown): FluxNode {
  return {
    id,
    type: "flux",
    position: { x: 0, y: 0 },
    data: { nodeType, title: id, config: {}, ...(pinned !== undefined ? { pinned } : {}) },
  };
}

function edge(source: string, target: string): FluxEdge {
  return { id: `${source}-${target}`, source, target };
}

function run(executions: Array<{ nodeId: string; output: unknown }>): WorkflowRun {
  return {
    id: "run_1",
    workflowId: "wf",
    status: "success",
    trigger: "manual",
    payload: { id: 7 },
    error: null,
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    replayOfId: null,
    nodeExecutions: executions.map((e, i) => ({
      id: `ne_${i}`,
      nodeId: e.nodeId,
      status: "success" as const,
      input: null,
      output: e.output,
      error: null,
      startedAt: null,
      finishedAt: null,
    })),
  };
}

// t (trigger) → a (http) → c (response)
const nodes = [node("t", "trigger.manual"), node("a", "action.http"), node("c", "output.response")];
const edges = [edge("t", "a"), edge("a", "c")];

describe("buildSampleScope", () => {
  it("exposes ancestor outputs by id plus an `input` alias for the sole parent", () => {
    const { scope } = buildSampleScope(nodes, edges, run([{ nodeId: "a", output: { body: { ok: true } } }]), "c");
    expect(scope.a).toEqual({ body: { ok: true } });
    expect(scope.input).toEqual({ body: { ok: true } }); // sole direct parent of c
  });

  it("surfaces the trigger payload under the `trigger` key from the active run", () => {
    const { scope } = buildSampleScope(nodes, edges, run([]), "a");
    expect(scope.trigger).toEqual({ id: 7 });
  });

  it("prefers pinned data over last-run output for an ancestor", () => {
    const withPin = [node("t", "trigger.manual"), node("a", "action.http", { body: "PINNED" }), node("c", "output.response")];
    const { scope, sources } = buildSampleScope(withPin, edges, run([{ nodeId: "a", output: { body: "LIVE" } }]), "c");
    expect(scope.a).toEqual({ body: "PINNED" });
    expect(sources.find((s) => s.id === "a")?.origin).toBe("pinned");
  });

  it("lets a pinned trigger node stand in for the trigger payload at design time", () => {
    const pinnedTrigger = [node("t", "trigger.manual", { id: 99 }), node("a", "action.http"), node("c", "output.response")];
    const { scope, sources } = buildSampleScope(pinnedTrigger, edges, null, "a");
    expect(scope.trigger).toEqual({ id: 99 });
    // The trigger source is offered under the canonical `trigger` prefix.
    expect(sources.find((s) => s.id === "t")?.basePath).toBe("trigger");
  });

  it("marks ancestors with no sample data as origin 'none' and omits them from scope", () => {
    const { scope, sources } = buildSampleScope(nodes, edges, null, "c");
    expect(scope.a).toBeUndefined();
    expect(sources.find((s) => s.id === "a")?.origin).toBe("none");
  });

  it("only includes ancestors of the target, not unrelated or downstream nodes", () => {
    const { sources } = buildSampleScope(nodes, edges, run([]), "a");
    // a's only ancestor is t; c is downstream and must not appear.
    expect(sources.map((s) => s.id)).toEqual(["t"]);
  });
});

describe("lastRunSources", () => {
  it("maps node ids to their last-run output, skipping empty outputs", () => {
    const sources = lastRunSources(run([{ nodeId: "a", output: { x: 1 } }, { nodeId: "b", output: null }]));
    expect(sources).toEqual({ a: { x: 1 } });
  });

  it("returns an empty map when there is no run", () => {
    expect(lastRunSources(null)).toEqual({});
  });
});
