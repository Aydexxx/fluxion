import { describe, expect, it } from "vitest";
import { buildTimeline } from "../timeline";
import type { NodeExecution, WorkflowRun } from "../../lib/types";

const T0 = Date.parse("2026-06-25T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function exec(nodeId: string, start: number, end: number | null, extra: Partial<NodeExecution> = {}): NodeExecution {
  return {
    id: `ne_${nodeId}`,
    nodeId,
    status: end === null ? "running" : "success",
    input: null,
    output: null,
    error: null,
    attempts: 1,
    startedAt: at(start),
    finishedAt: end === null ? null : at(end),
    ...extra,
  };
}

function run(nodeExecutions: NodeExecution[], over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run_1",
    workflowId: "wf",
    status: "success",
    trigger: "manual",
    payload: null,
    error: null,
    createdAt: at(0),
    startedAt: at(0),
    finishedAt: at(300),
    replayOfId: null,
    nodeExecutions,
    ...over,
  };
}

describe("buildTimeline", () => {
  it("orders bars by start time and computes offsets/durations relative to the baseline", () => {
    const timeline = buildTimeline(run([exec("b", 100, 250), exec("a", 0, 100)]));

    expect(timeline.bars.map((b) => b.nodeId)).toEqual(["a", "b"]);
    expect(timeline.bars[0]).toMatchObject({ nodeId: "a", offsetMs: 0, durationMs: 100, running: false });
    expect(timeline.bars[1]).toMatchObject({ nodeId: "b", offsetMs: 100, durationMs: 150 });
    expect(timeline.totalMs).toBe(300); // run start (0) → run finish (300)
  });

  it("grows a running node's bar up to `now` for a live run", () => {
    const timeline = buildTimeline(
      run([exec("a", 0, 100), exec("live", 100, null)], { status: "running", finishedAt: null }),
      T0 + 400,
    );

    const liveBar = timeline.bars.find((b) => b.nodeId === "live")!;
    expect(liveBar.running).toBe(true);
    expect(liveBar.durationMs).toBe(300); // 100 → now(400)
    expect(timeline.totalMs).toBe(400);
  });

  it("surfaces retry counts and maps statuses onto the canvas vocabulary", () => {
    const timeline = buildTimeline(
      run([exec("retried", 0, 200, { attempts: 3, status: "failed" })], { status: "failed", finishedAt: at(200) }),
    );
    expect(timeline.bars[0]).toMatchObject({ attempts: 3, status: "failed" });
  });

  it("never divides by zero for an empty / instant run", () => {
    const timeline = buildTimeline(run([], { startedAt: at(0), finishedAt: at(0) }), T0);
    expect(timeline.bars).toEqual([]);
    expect(timeline.totalMs).toBeGreaterThanOrEqual(1);
  });
});
