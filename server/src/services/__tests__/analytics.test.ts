import { describe, expect, it } from "vitest";
import { aggregateAnalytics, type AnalyticsNodeFailRow, type AnalyticsRunRow } from "../analytics";

function run(partial: Partial<AnalyticsRunRow> & Pick<AnalyticsRunRow, "status" | "createdAt">): AnalyticsRunRow {
  return {
    workflowId: "wf1",
    workflowName: "Flow 1",
    startedAt: null,
    finishedAt: null,
    ...partial,
  };
}

const from = new Date("2026-06-01T00:00:00Z");
const to = new Date("2026-06-03T00:00:00Z");

describe("aggregateAnalytics", () => {
  it("computes summary counts, success rate, and average duration", () => {
    const runs: AnalyticsRunRow[] = [
      run({ status: "success", createdAt: new Date("2026-06-01T10:00:00Z"), startedAt: new Date("2026-06-01T10:00:00Z"), finishedAt: new Date("2026-06-01T10:00:02Z") }), // 2000ms
      run({ status: "failed", createdAt: new Date("2026-06-01T11:00:00Z"), startedAt: new Date("2026-06-01T11:00:00Z"), finishedAt: new Date("2026-06-01T11:00:04Z") }), // 4000ms
      run({ status: "success", createdAt: new Date("2026-06-02T09:00:00Z"), startedAt: new Date("2026-06-02T09:00:00Z"), finishedAt: new Date("2026-06-02T09:00:06Z") }), // 6000ms
      run({ status: "running", createdAt: new Date("2026-06-02T12:00:00Z") }),
      run({ status: "queued", createdAt: new Date("2026-06-03T00:00:00Z") }),
    ];

    const result = aggregateAnalytics(runs, [], { from, to });

    expect(result.summary).toMatchObject({ total: 5, success: 2, failed: 1, running: 1, queued: 1 });
    // 2 success / 3 terminal = 67%
    expect(result.summary.successRate).toBe(67);
    // mean of 2000, 4000, 6000
    expect(result.summary.avgDurationMs).toBe(4000);
  });

  it("buckets runs into a gap-free daily series across the range", () => {
    const runs: AnalyticsRunRow[] = [
      run({ status: "success", createdAt: new Date("2026-06-01T08:00:00Z") }),
      run({ status: "failed", createdAt: new Date("2026-06-01T20:00:00Z") }),
      run({ status: "success", createdAt: new Date("2026-06-03T00:00:00Z") }),
    ];

    const result = aggregateAnalytics(runs, [], { from, to });

    expect(result.runsOverTime).toEqual([
      { date: "2026-06-01", success: 1, failed: 1, total: 2 },
      { date: "2026-06-02", success: 0, failed: 0, total: 0 }, // gap day still present
      { date: "2026-06-03", success: 1, failed: 0, total: 1 },
    ]);
  });

  it("ranks the most-failing workflows", () => {
    const runs: AnalyticsRunRow[] = [
      run({ status: "failed", workflowId: "a", workflowName: "Alpha", createdAt: from }),
      run({ status: "failed", workflowId: "a", workflowName: "Alpha", createdAt: from }),
      run({ status: "success", workflowId: "a", workflowName: "Alpha", createdAt: from }),
      run({ status: "failed", workflowId: "b", workflowName: "Beta", createdAt: from }),
    ];

    const result = aggregateAnalytics(runs, [], { from, to });

    expect(result.topFailingWorkflows).toEqual([
      { workflowId: "a", name: "Alpha", failures: 2, total: 3 },
      { workflowId: "b", name: "Beta", failures: 1, total: 1 },
    ]);
  });

  it("ranks the most-failing nodes by (workflow, node)", () => {
    const fails: AnalyticsNodeFailRow[] = [
      { workflowId: "a", workflowName: "Alpha", nodeId: "http1" },
      { workflowId: "a", workflowName: "Alpha", nodeId: "http1" },
      { workflowId: "a", workflowName: "Alpha", nodeId: "db1" },
      { workflowId: "b", workflowName: "Beta", nodeId: "http1" },
    ];

    const result = aggregateAnalytics([], fails, { from, to });

    expect(result.topFailingNodes[0]).toEqual({ workflowId: "a", workflowName: "Alpha", nodeId: "http1", failures: 2 });
    expect(result.topFailingNodes).toHaveLength(3);
  });

  it("handles an empty workspace without dividing by zero", () => {
    const result = aggregateAnalytics([], [], { from, to });
    expect(result.summary).toMatchObject({ total: 0, successRate: 0, avgDurationMs: 0 });
    expect(result.topFailingWorkflows).toEqual([]);
  });
});
