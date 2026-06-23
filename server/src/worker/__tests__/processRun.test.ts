import { describe, expect, it, vi } from "vitest";
import { handleJobFailure, processRun, runJob, RunFailedError, type ProcessRunDeps } from "../processRun";
import { InMemoryRunRecorder } from "../../engine/persistence";
import { createDefaultRegistry } from "../../engine/registry";
import type { RunEvent } from "../../engine/events";
import type { LlmSettings } from "../../engine/types";
import type { WorkflowDefinition } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

const happyDefinition: WorkflowDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "out", type: "output.response", position: { x: 0, y: 0 }, config: { body: "done" } },
  ],
  edges: [{ id: "e1", source: "t", target: "out" }],
};

const failingDefinition: WorkflowDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "boom", type: "does.not.exist", position: { x: 0, y: 0 }, config: {} },
  ],
  edges: [{ id: "e1", source: "t", target: "boom" }],
};

function makeDeps(definition: WorkflowDefinition, events?: RunEvent[]): { deps: ProcessRunDeps; recorder: InMemoryRunRecorder } {
  const recorder = new InMemoryRunRecorder();
  const deps: ProcessRunDeps = {
    recorder,
    loadWorkflow: vi.fn(async () => ({ definition, workspaceId: "ws" })),
    registry: createDefaultRegistry(),
    llm,
    onEvent: events ? (e) => events.push(e) : undefined,
  };
  return { deps, recorder };
}

async function enqueue(recorder: InMemoryRunRecorder): Promise<string> {
  return recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: { hi: 1 } });
}

describe("processRun — happy path", () => {
  it("executes a queued run to success and persists node executions", async () => {
    const { deps, recorder } = makeDeps(happyDefinition);
    const runId = await enqueue(recorder);

    const result = await processRun(runId, deps);

    expect(result.status).toBe("success");
    expect(result.nodeExecutions).toHaveLength(2);
    expect(deps.loadWorkflow).toHaveBeenCalledWith("wf");
  });
});

describe("processRun — idempotency", () => {
  it("does not re-execute a run that already succeeded", async () => {
    const { deps, recorder } = makeDeps(happyDefinition);
    const runId = await enqueue(recorder);
    await processRun(runId, deps); // first execution
    (deps.loadWorkflow as ReturnType<typeof vi.fn>).mockClear();

    const second = await processRun(runId, deps); // duplicate delivery

    expect(second.status).toBe("success");
    // short-circuited before touching the workflow loader or re-running nodes
    expect(deps.loadWorkflow).not.toHaveBeenCalled();
  });
});

describe("runJob — retry signalling", () => {
  it("returns normally when the run succeeds", async () => {
    const { deps, recorder } = makeDeps(happyDefinition);
    const runId = await enqueue(recorder);
    await expect(runJob(runId, deps)).resolves.toMatchObject({ status: "success" });
  });

  it("throws RunFailedError when the run fails (so the queue retries)", async () => {
    const { deps, recorder } = makeDeps(failingDefinition);
    const runId = await enqueue(recorder);
    await expect(runJob(runId, deps)).rejects.toBeInstanceOf(RunFailedError);
  });
});

describe("handleJobFailure — retry vs dead-letter", () => {
  it("re-queues the run between attempts (not yet exhausted)", async () => {
    const events: RunEvent[] = [];
    const { deps, recorder } = makeDeps(failingDefinition, events);
    const runId = await enqueue(recorder);
    await runJob(runId, deps).catch(() => {}); // attempt 1 fails

    await handleJobFailure(deps, { runId, attemptsMade: 1, maxAttempts: 3, error: new Error("boom") });

    const run = await recorder.getRun(runId);
    expect(run.status).toBe("queued");
    expect(events.some((e) => e.type === "run:finished")).toBe(false);
  });

  it("records the run failed with context once attempts are exhausted (dead-letter)", async () => {
    const events: RunEvent[] = [];
    const { deps, recorder } = makeDeps(failingDefinition, events);
    const runId = await enqueue(recorder);
    await runJob(runId, deps).catch(() => {});

    await handleJobFailure(deps, { runId, attemptsMade: 3, maxAttempts: 3, error: new Error("boom") });

    const run = await recorder.getRun(runId);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/after 3 attempt\(s\): boom/);
    expect(events.at(-1)).toMatchObject({ type: "run:finished", status: "failed" });
  });
});
