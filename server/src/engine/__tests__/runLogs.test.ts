import { describe, expect, it } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder } from "../persistence";
import type { RunEvent, RunLogEntry } from "../events";
import type { LlmSettings } from "../types";
import type { WorkflowDefinition } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config };
}

interface RunCapture {
  recorder: InMemoryRunRecorder;
  runId: string;
  events: RunEvent[];
  logs: RunLogEntry[];
}

async function run(definition: WorkflowDefinition): Promise<RunCapture> {
  const recorder = new InMemoryRunRecorder();
  const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: null });
  const events: RunEvent[] = [];
  const logs: RunLogEntry[] = [];
  await runWorkflow({
    runId,
    workflowId: "wf",
    workspaceId: "ws",
    definition,
    trigger: { type: "manual", payload: null },
    registry: createDefaultRegistry(),
    recorder,
    llm,
    onEvent: (e) => events.push(e),
    onLog: (_id, entry) => logs.push(entry),
  });
  return { recorder, runId, events, logs };
}

const linear: WorkflowDefinition = {
  nodes: [node("t", "trigger.manual"), node("x", "action.transform", { mappings: { a: 1 } }), node("out", "output.response")],
  edges: [
    { id: "e1", source: "t", target: "x" },
    { id: "e2", source: "x", target: "out" },
  ],
};

describe("run logs (structured, streamed)", () => {
  it("streams + persists ordered log lines with a stable shape", async () => {
    const { recorder, runId, logs } = await run(linear);

    // Streamed lines match what was persisted, in seq order.
    const stored = await recorder.listRunLogs(runId);
    expect(stored).toEqual(logs);
    expect(stored.map((l) => l.seq)).toEqual([...stored].map((_, i) => i + 1));

    for (const entry of stored) {
      expect(entry).toMatchObject({
        seq: expect.any(Number),
        ts: expect.any(String),
        message: expect.any(String),
      });
      expect(["debug", "info", "warn", "error"]).toContain(entry.level);
    }

    // The first line is run-scoped; node lines carry their nodeId.
    expect(stored[0]).toMatchObject({ level: "info", nodeId: null });
    expect(stored.find((l) => l.message.includes("(action.transform)"))).toMatchObject({ nodeId: "x" });
    expect(stored.at(-1)).toMatchObject({ message: "Run finished: success" });
  });

  it("incremental fetch returns only lines after a sequence number", async () => {
    const { recorder, runId } = await run(linear);
    const all = await recorder.listRunLogs(runId);
    const tail = await recorder.listRunLogs(runId, 2);
    expect(tail.every((l) => l.seq > 2)).toBe(true);
    expect(tail).toHaveLength(all.length - 2);
  });

  it("records attempts on node executions and logs each failed attempt", async () => {
    const flaky: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        // An unknown executor always fails; retry twice (3 attempts) then stop.
        node("boom", "does.not.exist", { onError: "stop", retry: { maxAttempts: 1 } }),
      ],
      edges: [{ id: "e1", source: "t", target: "boom" }],
    };
    const { recorder, runId, logs } = await run(flaky);

    const stored = await recorder.getRun(runId);
    const boom = stored.nodeExecutions.find((n) => n.nodeId === "boom");
    expect(boom?.status).toBe("failed");
    expect(boom?.attempts).toBe(1);

    // A node that succeeds on the first try records a single attempt.
    const okRun = await run(linear);
    const okStored = await okRun.recorder.getRun(okRun.runId);
    expect(okStored.nodeExecutions.every((n) => n.attempts === 1)).toBe(true);

    expect(logs.some((l) => l.level === "error" && l.nodeId === "boom")).toBe(true);
  });
});
