import { describe, expect, it } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import {
  createSubworkflowRunner,
  extractSubworkflowOutput,
  type PublishedWorkflowLoader,
  type SubworkflowRunnerDeps,
} from "../subworkflow";
import type { LlmSettings } from "../types";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

const WS = "ws_test";

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config };
}
function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target };
}

/** A workflow registered in the fake "published" catalog the loader reads from. */
interface CatalogEntry {
  workspaceId: string;
  definition: WorkflowDefinition;
}

function makeLoader(catalog: Record<string, CatalogEntry>): PublishedWorkflowLoader {
  return {
    async load(targetWorkflowId) {
      const entry = catalog[targetWorkflowId];
      if (!entry) return null;
      return { workflowId: targetWorkflowId, workspaceId: entry.workspaceId, definition: entry.definition };
    },
  };
}

/**
 * Runs a top-level workflow with sub-workflow support wired exactly like the
 * worker does: a runner rooted at this run, with the root workflow as the sole
 * ancestor. Returns the recorder (to inspect nested runs) + the top run record.
 */
async function runTop(
  rootWorkflowId: string,
  catalog: Record<string, CatalogEntry>,
  options: { payload?: unknown; maxDepth?: number } = {},
): Promise<{ recorder: InMemoryRunRecorder; record: RunRecord }> {
  const recorder = new InMemoryRunRecorder();
  const deps: SubworkflowRunnerDeps = {
    recorder,
    registry: createDefaultRegistry(),
    llm,
    loader: makeLoader(catalog),
    maxDepth: options.maxDepth,
  };
  const runId = await recorder.enqueueRun({
    workflowId: rootWorkflowId,
    trigger: "manual",
    payload: options.payload ?? null,
    definition: catalog[rootWorkflowId].definition,
  });
  const record = await runWorkflow({
    runId,
    workflowId: rootWorkflowId,
    workspaceId: WS,
    definition: catalog[rootWorkflowId].definition,
    trigger: { type: "manual", payload: options.payload ?? null },
    registry: deps.registry,
    recorder,
    llm,
    subworkflows: createSubworkflowRunner(deps, {
      workspaceId: WS,
      parentRunId: runId,
      ancestorWorkflowIds: [rootWorkflowId],
      depth: 0,
    }),
  });
  return { recorder, record };
}

const outputOf = (run: RunRecord, id: string) => run.nodeExecutions.find((n) => n.nodeId === id)?.output;

describe("sub-workflow — nested execution + output passing", () => {
  const child: WorkflowDefinition = {
    nodes: [node("ct", "trigger.manual"), node("cout", "output.response", { body: "Hello {{ trigger.name }}" })],
    edges: [edge("ce", "ct", "cout")],
  };

  it("runs the child as a nested run and exposes its output to the parent", async () => {
    const parent: WorkflowDefinition = {
      nodes: [
        node("pt", "trigger.manual"),
        node("call", "flow.subworkflow", { workflowId: "wf_child", input: [{ key: "name", value: "{{ trigger.who }}" }] }),
        node("pout", "output.response", { body: "{{ call.output }}" }),
      ],
      edges: [edge("e1", "pt", "call"), edge("e2", "call", "pout")],
    };

    const { record, recorder } = await runTop(
      "wf_parent",
      { wf_parent: { workspaceId: WS, definition: parent }, wf_child: { workspaceId: WS, definition: child } },
      { payload: { who: "Ada" } },
    );

    expect(record.status).toBe("success");

    // The call node's output carries the nested runId/status + the child's output.
    const callOut = outputOf(record, "call") as { runId: string; status: string; output: unknown };
    expect(callOut.status).toBe("success");
    expect(callOut.output).toBe("Hello Ada");

    // The parent's downstream node reads the sub-workflow output through the call node.
    expect(outputOf(record, "pout")).toEqual({ body: "Hello Ada" });

    // The nested run was recorded, linked back to the parent run + calling node.
    const childRun = await recorder.getRun(callOut.runId);
    expect(childRun.status).toBe("success");
    expect(childRun.parentRunId).toBe(record.id);
    expect(childRun.parentNodeId).toBe("call");
    expect(childRun.workflowId).toBe("wf_child");
  });
});

describe("sub-workflow — depth limit", () => {
  it("rejects a call that would exceed the max nesting depth", async () => {
    // a -> b -> c, with maxDepth 1: a's call (depth 1) is allowed, b's call (depth 2) is rejected.
    const leaf: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("o", "output.response", { body: "leaf" })],
      edges: [edge("e", "t", "o")],
    };
    const caller = (target: string): WorkflowDefinition => ({
      nodes: [node("t", "trigger.manual"), node("call", "flow.subworkflow", { workflowId: target })],
      edges: [edge("e", "t", "call")],
    });

    const { record, recorder } = await runTop(
      "wf_a",
      {
        wf_a: { workspaceId: WS, definition: caller("wf_b") },
        wf_b: { workspaceId: WS, definition: caller("wf_c") },
        wf_c: { workspaceId: WS, definition: leaf },
      },
      { maxDepth: 1 },
    );

    expect(record.status).toBe("failed");
    // The deepest call (b -> c) is the one that trips the limit.
    const bRun = (await recorder.getRun(record.id)).nodeExecutions.find((n) => n.nodeId === "call");
    expect(bRun?.error).toMatch(/nesting limit/i);
  });
});

describe("sub-workflow — cycle detection", () => {
  it("rejects a workflow that re-enters one already on the call stack", async () => {
    // a -> b -> a : the second call into 'a' is a cycle.
    const aToB: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("call", "flow.subworkflow", { workflowId: "wf_b" })],
      edges: [edge("e", "t", "call")],
    };
    const bToA: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("call", "flow.subworkflow", { workflowId: "wf_a" })],
      edges: [edge("e", "t", "call")],
    };

    const { record } = await runTop("wf_a", {
      wf_a: { workspaceId: WS, definition: aToB },
      wf_b: { workspaceId: WS, definition: bToA },
    });

    expect(record.status).toBe("failed");
    expect(record.error).toMatch(/cycle/i);
  });
});

describe("sub-workflow — target resolution", () => {
  it("fails clearly when the target is in another workspace", async () => {
    const parent: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("call", "flow.subworkflow", { workflowId: "wf_foreign" })],
      edges: [edge("e", "t", "call")],
    };
    const foreign: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("o", "output.response", { body: "x" })],
      edges: [edge("e", "t", "o")],
    };

    const { record } = await runTop("wf_parent", {
      wf_parent: { workspaceId: WS, definition: parent },
      wf_foreign: { workspaceId: "ws_other", definition: foreign },
    });

    expect(record.status).toBe("failed");
    expect(record.error).toMatch(/not in this workspace/i);
  });

  it("fails clearly when the target has no published version", async () => {
    const parent: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("call", "flow.subworkflow", { workflowId: "wf_missing" })],
      edges: [edge("e", "t", "call")],
    };
    const { record } = await runTop("wf_parent", { wf_parent: { workspaceId: WS, definition: parent } });

    expect(record.status).toBe("failed");
    expect(record.error).toMatch(/not found or has no published version/i);
  });
});

describe("extractSubworkflowOutput", () => {
  const base = (def: WorkflowDefinition, execs: Array<{ nodeId: string; output: unknown }>): RunRecord => ({
    id: "r",
    workflowId: "w",
    status: "success",
    trigger: "manual",
    payload: null,
    error: null,
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    definition: def,
    replayOfId: null,
    parentRunId: null,
    parentNodeId: null,
    nodeExecutions: execs.map((e, i) => ({
      id: `n${i}`,
      nodeId: e.nodeId,
      status: "success",
      input: null,
      output: e.output,
      error: null,
      attempts: 1,
      startedAt: null,
      finishedAt: null,
    })),
  });

  it("returns the single Response node's body", () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("o", "output.response")],
      edges: [edge("e", "t", "o")],
    };
    expect(extractSubworkflowOutput(base(def, [{ nodeId: "o", output: { body: { ok: true } } }]))).toEqual({ ok: true });
  });

  it("falls back to the single terminal node's output when there is no Response node", () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("x", "action.transform")],
      edges: [edge("e", "t", "x")],
    };
    expect(extractSubworkflowOutput(base(def, [{ nodeId: "x", output: { v: 1 } }]))).toEqual({ v: 1 });
  });

  it("returns null when nothing terminal produced output", () => {
    const def: WorkflowDefinition = { nodes: [node("t", "trigger.manual")], edges: [] };
    expect(extractSubworkflowOutput(base(def, []))).toBeNull();
  });
});
