import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { runApi, workflowApi, errorMessage } from "../lib/api";
import type { ExecutionStatus, WorkflowRun, WorkflowSummary, WorkspaceRunSummary } from "../lib/types";
import { TopNav } from "../components/TopNav";
import { StatusBadge, JsonBlock } from "../editor/RunBits";
import { Select } from "../components/Field";
import { CloseIcon, HistoryIcon, PlayIcon, SpinnerIcon } from "../components/icons";
import { formatDuration, timeAgo } from "../lib/format";
import { navigate } from "../lib/router";
import { toast } from "../store/toasts";
import { EASE } from "../lib/motion";

const STATUSES: (ExecutionStatus | "all")[] = ["all", "queued", "running", "success", "failed"];
const RANGES = [
  { key: "1", label: "24h", days: 1 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: 0 },
];

function rangeFrom(days: number): string | undefined {
  if (days <= 0) return undefined;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function RunsPage() {
  const workspace = useAuth((s) => s.workspace);

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [status, setStatus] = useState<ExecutionStatus | "all">("all");
  const [workflowId, setWorkflowId] = useState<string>("all");
  const [rangeKey, setRangeKey] = useState("7");

  const [runs, setRuns] = useState<WorkspaceRunSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const buildFilters = () => ({
    status: status === "all" ? undefined : status,
    workflowId: workflowId === "all" ? undefined : workflowId,
    from: rangeFrom(RANGES.find((r) => r.key === rangeKey)?.days ?? 7),
  });

  useEffect(() => {
    if (!workspace) return;
    void (async () => {
      try {
        setWorkflows(await workflowApi.list(workspace.id));
      } catch {
        /* leave the workflow filter empty on failure */
      }
    })();
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    void (async () => {
      setRuns(null);
      try {
        const list = await runApi.listWorkspace(workspace.id, buildFilters());
        if (alive) setRuns(list);
      } catch (err) {
        if (alive) {
          setRuns([]);
          toast.error(errorMessage(err, "Could not load runs"));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, status, workflowId, rangeKey]);

  const refresh = () => {
    if (!workspace) return;
    runApi
      .listWorkspace(workspace.id, buildFilters())
      .then(setRuns)
      .catch(() => {});
  };

  return (
    <div className="relative h-screen overflow-y-auto bg-base">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[360px] bloom opacity-70" />
      <TopNav active="runs" />

      <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-10">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-gradient">Runs</h1>
          <p className="mt-1 text-sm text-muted">Every execution across your workspace, with full node-level detail.</p>
        </div>

        {/* filters */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="w-[150px]">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ExecutionStatus | "all")}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[200px]">
            <Select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
              <option value="all">All workflows</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="ml-auto flex gap-1 rounded-lg border border-white/8 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRangeKey(r.key)}
                className="rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                style={{
                  color: rangeKey === r.key ? "var(--color-ink)" : "var(--color-faint)",
                  background: rangeKey === r.key ? "color-mix(in oklab, white 7%, transparent)" : "transparent",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* table */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/8 bg-surface/40">
          {runs === null ? (
            <div className="flex items-center justify-center py-16 text-muted">
              <SpinnerIcon className="animate-spin text-[18px]" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <HistoryIcon className="text-[24px] text-faint" />
              <p className="text-sm text-muted">No runs match these filters.</p>
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/8 text-[11px] uppercase tracking-[0.1em] text-faint">
                  <th className="px-4 py-2.5 font-medium">Workflow</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Trigger</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Duration</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedId(run.id)}
                    className="cursor-pointer border-b border-white/5 transition-colors last:border-0 hover:bg-white/4"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{run.workflowName}</div>
                      {run.replayOfId ? <div className="text-[11px] text-faint">replay</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">{run.trigger}</td>
                    <td className="hidden px-4 py-3 font-mono text-[12px] text-muted md:table-cell">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </td>
                    <td className="px-4 py-3 text-muted">{run.createdAt ? timeAgo(run.createdAt) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <ReplayButton runId={run.id} onReplayed={refresh} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <RunDetailDrawer runId={selectedId} onClose={() => setSelectedId(null)} onReplayed={refresh} />
    </div>
  );
}

function ReplayButton({ runId, onReplayed, compact }: { runId: string; onReplayed: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const replay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const fresh = await runApi.replay(runId);
      toast.success("Replay queued");
      onReplayed();
      void fresh;
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
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/8 font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-60 ${
        compact ? "px-2 py-1 text-[11.5px]" : "px-3 py-1.5 text-[13px]"
      }`}
    >
      {busy ? <SpinnerIcon className="animate-spin text-[13px]" /> : <PlayIcon className="text-[13px]" />} Replay
    </button>
  );
}

function RunDetailDrawer({ runId, onClose, onReplayed }: { runId: string | null; onClose: () => void; onReplayed: () => void }) {
  const reduce = useReducedMotion();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    void (async () => {
      setRun(null);
      setLoading(true);
      try {
        const r = await runApi.get(runId);
        if (alive) setRun(r);
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load run detail"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  return (
    <AnimatePresence>
      {runId ? (
        <div className="fixed inset-0 z-[70]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-void/60 backdrop-blur-sm" />
          <motion.aside
            initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col overflow-hidden border-l border-white/8 bg-base"
          >
            <header className="flex items-center justify-between border-b border-white/8 p-4">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">Run detail</h2>
                {run ? <p className="mt-0.5 font-mono text-[11px] text-faint">{run.id}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                {run ? <ReplayButton runId={run.id} onReplayed={onReplayed} /> : null}
                <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink">
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {loading || !run ? (
                <div className="flex items-center justify-center py-16 text-muted">
                  <SpinnerIcon className="animate-spin text-[18px]" />
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={run.status} />
                    <span className="text-[12px] text-muted">{run.trigger}</span>
                    <span className="font-mono text-[12px] text-faint">{formatDuration(run.startedAt, run.finishedAt)}</span>
                    {run.replayOfId ? (
                      <button
                        type="button"
                        onClick={() => navigate("/runs")}
                        className="rounded-md bg-white/6 px-2 py-0.5 font-mono text-[11px] text-muted hover:text-ink"
                        title={run.replayOfId}
                      >
                        ↳ replay of {run.replayOfId.slice(0, 8)}…
                      </button>
                    ) : null}
                  </div>

                  {run.error ? <JsonBlock label="Run error" value={run.error} tone="error" /> : null}

                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.13em] text-faint">
                      Nodes ({run.nodeExecutions.length})
                    </div>
                    <div className="space-y-3">
                      {run.nodeExecutions.map((exec) => (
                        <div key={exec.id} className="rounded-xl border border-white/8 bg-surface/40 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="font-mono text-[12px] text-ink">{exec.nodeId}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-faint">{formatDuration(exec.startedAt, exec.finishedAt)}</span>
                              <StatusBadge status={exec.status} dim />
                            </div>
                          </div>
                          {exec.error ? <JsonBlock label="Error" value={exec.error} tone="error" /> : null}
                          <div className="mt-2 grid gap-2">
                            <JsonBlock label="Input" value={exec.input} />
                            <JsonBlock label="Output" value={exec.output} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
