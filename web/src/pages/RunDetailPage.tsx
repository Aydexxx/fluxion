import { useEffect, useMemo, useRef, useState } from "react";
import { runApi, errorMessage } from "../lib/api";
import type { NestedRunRef, NodeExecution, RunLogEntry, RunLogLevel, WorkflowRun } from "../lib/types";
import { subscribeRunStream } from "../lib/runStream";
import { buildTimeline, type TimelineBar } from "../editor/timeline";
import { statusVisual } from "../editor/runStatus";
import { StatusBadge, JsonBlock } from "../editor/RunBits";
import { ChevronRightIcon, CloseIcon, HistoryIcon, PlayIcon, SpinnerIcon } from "../components/icons";
import { formatDuration, timeAgo } from "../lib/format";
import { navigate } from "../lib/router";
import { toast } from "../store/toasts";

/** Statuses that mean the run is still progressing (so we keep the live stream warm). */
const LIVE = new Set(["queued", "running"]);

export function RunDetailPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Preselect the node from `?node=` (the list's "jump to failing node" action).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("node"),
  );
  // Highest log seq we've stored, so live + fetched lines never duplicate.
  const maxSeq = useRef(0);

  const live = run ? LIVE.has(run.status) : false;

  // Initial load: the run + any logs already recorded.
  useEffect(() => {
    let alive = true;
    void (async () => {
      setRun(null);
      setLogs([]);
      setError(null);
      maxSeq.current = 0;
      // Re-honor a `?node=` deep link when navigating between run details.
      setSelectedNodeId(new URLSearchParams(window.location.search).get("node"));
      try {
        const [r, l] = await Promise.all([runApi.get(runId), runApi.logs(runId)]);
        if (!alive) return;
        setRun(r);
        setLogs(l);
        maxSeq.current = l.reduce((m, e) => Math.max(m, e.seq), 0);
      } catch (err) {
        if (alive) setError(errorMessage(err, "Could not load this run"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  // Live stream: refetch the run (throttled) on lifecycle events for fresh
  // timing/IO, and append log lines as they arrive.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer || !alive) return;
      timer = setTimeout(async () => {
        timer = null;
        try {
          const r = await runApi.get(runId);
          if (alive) setRun(r);
        } catch {
          /* transient — the next event will retry */
        }
      }, 350);
    };

    const sub = subscribeRunStream(runId, {
      onEvent: () => refresh(),
      onLog: (entry) => {
        if (!alive || entry.seq <= maxSeq.current) return;
        maxSeq.current = entry.seq;
        setLogs((prev) => [...prev, entry]);
      },
    });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [runId]);

  const selectedExec = useMemo(
    () => run?.nodeExecutions.find((e) => e.nodeId === selectedNodeId) ?? null,
    [run, selectedNodeId],
  );

  const childRuns = useMemo(() => run?.childRuns ?? [], [run]);
  // Nested runs keyed by the Call Workflow node that spawned them, for inline links.
  const childByNode = useMemo(() => {
    const map = new Map<string, NestedRunRef>();
    for (const c of childRuns) if (c.parentNodeId) map.set(c.parentNodeId, c);
    return map;
  }, [childRuns]);

  return (
    <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
        <button
          type="button"
          onClick={() => navigate("/runs")}
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          <ChevronRightIcon className="rotate-180 text-[14px]" /> All runs
        </button>

        {error ? (
          <EmptyState message={error} />
        ) : !run ? (
          <div className="flex items-center justify-center py-24 text-muted">
            <SpinnerIcon className="animate-spin text-[20px]" />
          </div>
        ) : (
          <>
            <RunHeader run={run} live={live} onReplayed={(fresh) => navigate(`/runs/${fresh}`)} />

            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_minmax(320px,380px)]">
              <div className="min-w-0 space-y-5">
                <ExecutionTimeline
                  run={run}
                  live={live}
                  selectedNodeId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                  childByNode={childByNode}
                />
                {childRuns.length > 0 ? <NestedRunsPanel childRuns={childRuns} /> : null}
                <LogsPanel logs={logs} live={live} />
              </div>
              <NodeInspector exec={selectedExec} nodeId={selectedNodeId} child={selectedNodeId ? childByNode.get(selectedNodeId) ?? null : null} />
            </div>
          </>
        )}
    </main>
  );
}

function RunHeader({ run, live, onReplayed }: { run: WorkflowRun; live: boolean; onReplayed: (id: string) => void }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-surface/40 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={run.status} />
        {live ? <LivePill /> : null}
        <span className="text-[13px] text-muted">{run.trigger}</span>
        <span className="font-mono text-[12px] text-faint">{formatDuration(run.startedAt, run.finishedAt)}</span>
        {run.createdAt ? <span className="text-[12px] text-faint">· {timeAgo(run.createdAt)}</span> : null}
        {run.replayOfId ? (
          <button
            type="button"
            onClick={() => navigate(`/runs/${run.replayOfId}`)}
            className="rounded-md bg-white/6 px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:text-ink"
            title={run.replayOfId}
          >
            ↳ replay of {run.replayOfId.slice(0, 8)}…
          </button>
        ) : null}
        {run.parentRun ? (
          <button
            type="button"
            onClick={() => navigate(`/runs/${run.parentRun!.id}`)}
            className="rounded-md bg-white/6 px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-ink"
            title={`Nested run of ${run.parentRun.workflowName}`}
          >
            ↳ nested in {run.parentRun.workflowName}
          </button>
        ) : null}
        <div className="ml-auto">
          <ReplayButton runId={run.id} onReplayed={onReplayed} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {/* The correlation id ties the UI, logs, and structured server logs together. */}
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">run</span>
        <code className="select-all rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11.5px] text-muted">{run.id}</code>
      </div>
      {run.error ? <div className="mt-3"><JsonBlock label="Run error" value={run.error} tone="error" /></div> : null}
    </div>
  );
}

function LivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-medium text-amber-300">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-amber-400" />
      </span>
      Live
    </span>
  );
}

/** Gantt-style execution timeline: one bar per node, placed by start offset and sized by duration. */
function ExecutionTimeline({
  run,
  live,
  selectedNodeId,
  onSelect,
  childByNode,
}: {
  run: WorkflowRun;
  live: boolean;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  childByNode: Map<string, NestedRunRef>;
}) {
  // Recompute against a ticking clock while live, so in-progress bars grow.
  const [, force] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live]);

  const timeline = useMemo(() => buildTimeline(run), [run, live]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="rounded-2xl border border-white/8 bg-surface/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold text-ink">Execution timeline</h2>
        <span className="font-mono text-[11px] text-faint">{formatTotal(timeline.totalMs)}</span>
      </div>

      {timeline.bars.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">No nodes have executed yet.</p>
      ) : (
        <div className="space-y-1.5">
          {timeline.bars.map((bar) => (
            <TimelineRow
              key={bar.id}
              bar={bar}
              totalMs={timeline.totalMs}
              selected={bar.nodeId === selectedNodeId}
              onSelect={() => onSelect(bar.nodeId)}
              nested={childByNode.has(bar.nodeId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineRow({
  bar,
  totalMs,
  selected,
  onSelect,
  nested,
}: {
  bar: TimelineBar;
  totalMs: number;
  selected: boolean;
  onSelect: () => void;
  nested?: boolean;
}) {
  const color = statusVisual(bar.status).color;
  const leftPct = (bar.offsetMs / totalMs) * 100;
  // Floor the width so a sub-millisecond node is still visible/clickable.
  const widthPct = Math.max((bar.durationMs / totalMs) * 100, 1.5);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group grid w-full grid-cols-[120px_1fr] items-center gap-3 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/4"
      style={{ background: selected ? "color-mix(in oklab, white 6%, transparent)" : undefined }}
    >
      <span className="flex items-center gap-1 truncate font-mono text-[11.5px] text-muted group-hover:text-ink" title={bar.nodeId}>
        {nested ? <span title="Calls a sub-workflow" className="shrink-0 text-[10px] text-[#5b8def]">⧉</span> : null}
        <span className="truncate">{bar.nodeId}</span>
      </span>
      <span className="relative h-5">
        <span className="absolute inset-y-0 left-0 right-0 rounded bg-white/[0.04]" />
        <span
          className="absolute inset-y-0 flex items-center rounded"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: 6,
            background: `color-mix(in oklab, ${color} ${bar.running ? 55 : 78}%, transparent)`,
            boxShadow: selected ? `0 0 0 1px ${color}` : undefined,
          }}
        >
          {bar.running ? <span className="absolute inset-0 animate-pulse rounded" style={{ background: color, opacity: 0.4 }} /> : null}
        </span>
        <span
          className="absolute -top-0.5 font-mono text-[10px] text-faint"
          style={{ left: `calc(${Math.min(leftPct + widthPct, 88)}% + 6px)` }}
        >
          {bar.attempts > 1 ? `↻${bar.attempts} · ` : ""}
          {bar.running ? "running" : formatMs(bar.durationMs)}
        </span>
      </span>
    </button>
  );
}

/** Lists the sub-workflow runs this run spawned, each linking to its own detail. */
function NestedRunsPanel({ childRuns }: { childRuns: NestedRunRef[] }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-surface/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold text-ink">Nested runs</h2>
        <span className="font-mono text-[11px] text-faint">{childRuns.length}</span>
      </div>
      <div className="space-y-1.5">
        {childRuns.map((child) => (
          <button
            key={child.id}
            type="button"
            onClick={() => navigate(`/runs/${child.id}`)}
            className="group flex w-full items-center gap-3 rounded-lg border border-white/6 bg-void/30 px-3 py-2 text-left transition-colors hover:border-white/14 hover:bg-white/4"
          >
            <StatusBadge status={child.status} dim />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{child.workflowName}</span>
              {child.parentNodeId ? (
                <span className="block truncate font-mono text-[11px] text-faint">via {child.parentNodeId}</span>
              ) : null}
            </span>
            <ChevronRightIcon className="shrink-0 text-[14px] text-faint transition-colors group-hover:text-ink" />
          </button>
        ))}
      </div>
    </section>
  );
}

/** Per-run structured logs, level-colored, auto-tailing while live. */
function LogsPanel({ logs, live }: { logs: RunLogEntry[]; live: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, live]);

  return (
    <section className="rounded-2xl border border-white/8 bg-surface/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold text-ink">Logs</h2>
        <span className="font-mono text-[11px] text-faint">{logs.length} line{logs.length === 1 ? "" : "s"}</span>
      </div>
      {logs.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted">No logs for this run.</p>
      ) : (
        <div ref={scrollRef} className="max-h-80 overflow-y-auto rounded-lg border border-white/6 bg-void/40 p-2 font-mono text-[12px] leading-relaxed">
          {logs.map((entry) => (
            <LogLine key={entry.seq} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

const LEVEL_COLOR: Record<RunLogLevel, string> = {
  debug: "var(--color-faint)",
  info: "color-mix(in oklab, white 75%, transparent)",
  warn: "#e0a33e",
  error: "#ff6b6b",
};

function LogLine({ entry }: { entry: RunLogEntry }) {
  return (
    <div className="flex gap-2 px-1 py-0.5">
      <span className="shrink-0 text-faint">{new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}</span>
      <span className="w-10 shrink-0 uppercase" style={{ color: LEVEL_COLOR[entry.level] }}>
        {entry.level}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink/90">{entry.message}</span>
    </div>
  );
}

/** Node-by-node inspector: input, output, error, timing, retries. */
function NodeInspector({
  exec,
  nodeId,
  child,
}: {
  exec: NodeExecution | null;
  nodeId: string | null;
  child: NestedRunRef | null;
}) {
  if (!nodeId) {
    return (
      <aside className="rounded-2xl border border-white/8 bg-surface/40 p-5">
        <p className="text-[13px] text-muted">Select a node in the timeline to inspect its input, output, and timing.</p>
      </aside>
    );
  }
  if (!exec) {
    return (
      <aside className="rounded-2xl border border-white/8 bg-surface/40 p-5">
        <div className="mb-1 font-mono text-[12px] text-ink">{nodeId}</div>
        <p className="text-[13px] text-muted">This node didn’t execute in this run — an upstream branch may have skipped it.</p>
      </aside>
    );
  }

  return (
    <aside className="rounded-2xl border border-white/8 bg-surface/40 p-5 lg:sticky lg:top-6 lg:self-start">
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate font-mono text-[13px] text-ink" title={exec.nodeId}>{exec.nodeId}</span>
        <StatusBadge status={exec.status} dim />
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-2 text-[12px]">
        <Meta label="Duration" value={formatDuration(exec.startedAt, exec.finishedAt)} />
        <Meta label="Attempts" value={String(exec.attempts ?? 1)} highlight={(exec.attempts ?? 1) > 1} />
        <Meta label="Started" value={exec.startedAt ? new Date(exec.startedAt).toLocaleTimeString(undefined, { hour12: false }) : "—"} />
        <Meta label="Finished" value={exec.finishedAt ? new Date(exec.finishedAt).toLocaleTimeString(undefined, { hour12: false }) : "—"} />
      </dl>
      {child ? (
        <button
          type="button"
          onClick={() => navigate(`/runs/${child.id}`)}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-[#5b8def]/30 bg-[#5b8def]/10 px-3 py-2 text-left text-[12.5px] text-[#a8c4ff] transition-colors hover:bg-[#5b8def]/16"
        >
          <span className="shrink-0">⧉</span>
          <span className="min-w-0 flex-1 truncate">
            Nested run · <span className="text-ink">{child.workflowName}</span>
          </span>
          <ChevronRightIcon className="shrink-0 text-[13px]" />
        </button>
      ) : null}
      <div className="space-y-3">
        {exec.error ? <JsonBlock label="Error" value={exec.error} tone="error" /> : null}
        <JsonBlock label="Input" value={exec.input} />
        <JsonBlock label="Output" value={exec.output} />
      </div>
    </aside>
  );
}

function Meta({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-white/6 bg-void/30 px-2.5 py-1.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-0.5 font-mono text-[12px]" style={{ color: highlight ? "#e0a33e" : "var(--color-ink)" }}>
        {value}
      </div>
    </div>
  );
}

function ReplayButton({ runId, onReplayed }: { runId: string; onReplayed: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const replay = async () => {
    setBusy(true);
    try {
      const fresh = await runApi.replay(runId);
      toast.success("Replay queued");
      onReplayed(fresh.id);
    } catch (err) {
      toast.error(errorMessage(err, "Could not replay this run"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={replay}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-60"
    >
      {busy ? <SpinnerIcon className="animate-spin text-[13px]" /> : <PlayIcon className="text-[13px]" />} Replay
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <HistoryIcon className="text-[26px] text-faint" />
      <p className="max-w-sm text-sm text-muted">{message}</p>
      <button
        type="button"
        onClick={() => navigate("/runs")}
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-white/5"
      >
        <CloseIcon className="text-[12px]" /> Back to runs
      </button>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTotal(ms: number): string {
  return ms <= 1 ? "—" : formatMs(ms);
}
