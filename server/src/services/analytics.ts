import type { ExecutionStatusValue } from "../engine/types";
import { prisma } from "./prisma";
import { requireWorkspaceMember } from "./authorization";

/** One run, flattened for aggregation. */
export interface AnalyticsRunRow {
  status: ExecutionStatusValue;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  workflowId: string;
  workflowName: string;
}

/** One failed node execution, flattened for aggregation. */
export interface AnalyticsNodeFailRow {
  nodeId: string;
  workflowId: string;
  workflowName: string;
}

export interface AnalyticsSummary {
  total: number;
  success: number;
  failed: number;
  running: number;
  queued: number;
  /** Success / (success + failed), as a 0–100 percentage; 0 when no terminal runs. */
  successRate: number;
  /** Mean wall-clock duration (ms) over runs that have both start and finish. */
  avgDurationMs: number;
}

export interface RunsOverTimePoint {
  date: string;
  success: number;
  failed: number;
  total: number;
}

export interface FailingWorkflow {
  workflowId: string;
  name: string;
  failures: number;
  total: number;
}

export interface FailingNode {
  workflowId: string;
  workflowName: string;
  nodeId: string;
  failures: number;
}

export interface AnalyticsResult {
  range: { from: string; to: string };
  summary: AnalyticsSummary;
  runsOverTime: RunsOverTimePoint[];
  topFailingWorkflows: FailingWorkflow[];
  topFailingNodes: FailingNode[];
}

/** UTC day key (YYYY-MM-DD) for bucketing. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive list of UTC day keys from `from` to `to`, so the time series has no gaps. */
function dayRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  // Guard against an inverted range producing an unbounded loop.
  if (cursor > end) return [dayKey(from)];
  while (cursor <= end) {
    days.push(dayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Pure aggregation over already-fetched rows — no I/O — so it's exhaustively
 * unit-testable and the service layer stays a thin data-loader around it.
 */
export function aggregateAnalytics(
  runs: AnalyticsRunRow[],
  nodeFails: AnalyticsNodeFailRow[],
  range: { from: Date; to: Date },
): AnalyticsResult {
  const summary: AnalyticsSummary = { total: runs.length, success: 0, failed: 0, running: 0, queued: 0, successRate: 0, avgDurationMs: 0 };

  let durationSum = 0;
  let durationCount = 0;
  const byDay = new Map<string, { success: number; failed: number; total: number }>();
  for (const day of dayRange(range.from, range.to)) byDay.set(day, { success: 0, failed: 0, total: 0 });

  const wf = new Map<string, FailingWorkflow>();

  for (const run of runs) {
    summary[run.status] += 1;

    if (run.startedAt && run.finishedAt) {
      const ms = run.finishedAt.getTime() - run.startedAt.getTime();
      if (ms >= 0) {
        durationSum += ms;
        durationCount += 1;
      }
    }

    const key = dayKey(run.createdAt);
    const bucket = byDay.get(key) ?? { success: 0, failed: 0, total: 0 };
    bucket.total += 1;
    if (run.status === "success") bucket.success += 1;
    if (run.status === "failed") bucket.failed += 1;
    byDay.set(key, bucket);

    const w = wf.get(run.workflowId) ?? { workflowId: run.workflowId, name: run.workflowName, failures: 0, total: 0 };
    w.total += 1;
    if (run.status === "failed") w.failures += 1;
    wf.set(run.workflowId, w);
  }

  const terminal = summary.success + summary.failed;
  summary.successRate = terminal === 0 ? 0 : Math.round((summary.success / terminal) * 100);
  summary.avgDurationMs = durationCount === 0 ? 0 : Math.round(durationSum / durationCount);

  const runsOverTime: RunsOverTimePoint[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const topFailingWorkflows = [...wf.values()]
    .filter((w) => w.failures > 0)
    .sort((a, b) => b.failures - a.failures || b.total - a.total)
    .slice(0, 5);

  const nodeKey = (n: AnalyticsNodeFailRow) => `${n.workflowId}::${n.nodeId}`;
  const nodes = new Map<string, FailingNode>();
  for (const n of nodeFails) {
    const existing = nodes.get(nodeKey(n));
    if (existing) existing.failures += 1;
    else nodes.set(nodeKey(n), { workflowId: n.workflowId, workflowName: n.workflowName, nodeId: n.nodeId, failures: 1 });
  }
  const topFailingNodes = [...nodes.values()].sort((a, b) => b.failures - a.failures).slice(0, 5);

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    summary,
    runsOverTime,
    topFailingWorkflows,
    topFailingNodes,
  };
}

const DEFAULT_WINDOW_DAYS = 30;

/** Fetches workspace runs + failed node executions in range and aggregates them. */
export async function getWorkspaceAnalytics(
  workspaceId: string,
  userId: string,
  options: { from?: string; to?: string } = {},
): Promise<AnalyticsResult> {
  await requireWorkspaceMember(workspaceId, userId);

  const to = options.to ? new Date(options.to) : new Date();
  const from = options.from ? new Date(options.from) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

  const [runs, nodeFails] = await Promise.all([
    prisma.workflowRun.findMany({
      where: { workflow: { workspaceId }, createdAt: { gte: from, lte: to } },
      select: {
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        workflowId: true,
        workflow: { select: { name: true } },
      },
    }),
    prisma.nodeExecution.findMany({
      where: { status: "failed", run: { workflow: { workspaceId }, createdAt: { gte: from, lte: to } } },
      select: { nodeId: true, run: { select: { workflowId: true, workflow: { select: { name: true } } } } },
    }),
  ]);

  const runRows: AnalyticsRunRow[] = runs.map((r) => ({
    status: r.status as ExecutionStatusValue,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    workflowId: r.workflowId,
    workflowName: r.workflow.name,
  }));
  const nodeRows: AnalyticsNodeFailRow[] = nodeFails.map((n) => ({
    nodeId: n.nodeId,
    workflowId: n.run.workflowId,
    workflowName: n.run.workflow.name,
  }));

  return aggregateAnalytics(runRows, nodeRows, { from, to });
}
