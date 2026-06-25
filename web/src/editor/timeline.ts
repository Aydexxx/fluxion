import type { NodeExecution, WorkflowRun } from "../lib/types";
import { toNodeRunStatus, type NodeRunStatus } from "./runStatus";

/**
 * One bar in the execution timeline (Gantt). Offsets/durations are in
 * milliseconds relative to the run's start; the view scales them to pixels.
 */
export interface TimelineBar {
  id: string;
  nodeId: string;
  status: NodeRunStatus;
  attempts: number;
  /** ms from run start to this node's start. */
  offsetMs: number;
  /** ms this node took (0 if still running / no finish recorded). */
  durationMs: number;
  /** True while the node is mid-flight (no finishedAt yet). */
  running: boolean;
}

export interface Timeline {
  /** Total span the bars are laid out against, in ms (>=1 to avoid divide-by-zero). */
  totalMs: number;
  bars: TimelineBar[];
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Builds Gantt-style timeline bars from a run's node executions, ordered by
 * start time. The baseline is the earliest of the run start and the first node
 * start; the span runs to the latest finish (or "now" for an in-progress run),
 * so live bars grow as the run executes.
 *
 * Pure and deterministic given `now`, so it's straightforward to unit-test.
 */
export function buildTimeline(run: WorkflowRun, now: number = Date.now()): Timeline {
  const execs = [...run.nodeExecutions].sort((a, b) => startOf(a) - startOf(b));

  const starts = execs.map(startOf).filter((t) => t > 0);
  const runStart = ms(run.startedAt);
  const baseline = Math.min(...(runStart ? [runStart, ...starts] : starts.length ? starts : [now]));

  const ends = execs.map((e) => ms(e.finishedAt)).filter((t): t is number => t !== null);
  const runEnd = ms(run.finishedAt);
  // For a finished run, end at its finish; for a live one, extend to `now`.
  const span = Math.max(runEnd ?? now, ...(ends.length ? ends : [baseline]));
  const totalMs = Math.max(span - baseline, 1);

  const bars: TimelineBar[] = execs.map((exec) => {
    const start = startOf(exec);
    const finish = ms(exec.finishedAt);
    const running = finish === null;
    const end = finish ?? now;
    return {
      id: exec.id,
      nodeId: exec.nodeId,
      status: toNodeRunStatus(exec.status),
      attempts: exec.attempts ?? 1,
      offsetMs: Math.max(start - baseline, 0),
      durationMs: Math.max(end - start, 0),
      running,
    };
  });

  return { totalMs, bars };
}

/** A node's start time in ms, falling back to the baseline (0) when missing. */
function startOf(exec: NodeExecution): number {
  return ms(exec.startedAt) ?? 0;
}
