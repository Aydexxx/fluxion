import { describe, expect, it, vi } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder } from "../persistence";
import type { RunEvent } from "../events";
import type { LlmSettings } from "../types";
import type { WorkflowDefinition } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

async function runWithEvents(definition: WorkflowDefinition, fetchImpl?: typeof fetch): Promise<RunEvent[]> {
  const recorder = new InMemoryRunRecorder();
  const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: null });
  const events: RunEvent[] = [];
  await runWorkflow({
    runId,
    workflowId: "wf",
    workspaceId: "ws",
    definition,
    trigger: { type: "manual", payload: null },
    registry: createDefaultRegistry(),
    recorder,
    llm,
    fetchImpl,
    onEvent: (e) => events.push(e),
  });
  return events;
}

/** Collapse events to a compact, order-significant signature for assertions. */
const signature = (events: RunEvent[]) =>
  events.map((e) =>
    e.type === "node:started"
      ? `start:${e.nodeId}`
      : e.type === "node:finished"
        ? `done:${e.nodeId}:${e.status}`
        : e.type,
  );

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config };
}

describe("runWorkflow events", () => {
  it("emits run/node lifecycle events in topological order", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("x", "action.transform", { mappings: { a: 1 } }), node("out", "output.response")],
      edges: [
        { id: "e1", source: "t", target: "x" },
        { id: "e2", source: "x", target: "out" },
      ],
    };

    const events = await runWithEvents(definition);

    expect(signature(events)).toEqual([
      "run:started",
      "start:t",
      "done:t:success",
      "start:x",
      "done:x:success",
      "start:out",
      "done:out:success",
      "run:finished",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run:finished", status: "success" });
  });

  it("emits node:finished failed and stops (fail-fast), without a terminal run:finished", async () => {
    const definition: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("boom", "does.not.exist"), node("after", "output.response")],
      edges: [
        { id: "e1", source: "t", target: "boom" },
        { id: "e2", source: "boom", target: "after" },
      ],
    };

    const events = await runWithEvents(definition);

    // The engine leaves the terminal failed event to the worker (retry/dead-letter aware).
    expect(signature(events)).toEqual([
      "run:started",
      "start:t",
      "done:t:success",
      "start:boom",
      "done:boom:failed",
    ]);
    expect(events.some((e) => e.type === "run:finished")).toBe(false);
  });

  it("does not emit events for gated-out (skipped) nodes", async () => {
    const fetchMock = vi.fn();
    const definition: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("cond", "logic.condition", { expression: "1 == 2" }),
        node("yes", "output.response"),
      ],
      edges: [
        { id: "e1", source: "t", target: "cond" },
        { id: "e2", source: "cond", target: "yes", sourceHandle: "true" },
      ],
    };

    const events = await runWithEvents(definition, fetchMock as unknown as typeof fetch);
    expect(signature(events)).not.toContain("start:yes");
  });
});
