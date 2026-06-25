import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../store/auth";
import { runApi, workflowApi, errorMessage } from "../lib/api";
import type { ExecutionStatus, RunTriggerType, WorkflowSummary, WorkspaceRunSummary } from "../lib/types";
import { TopNav } from "../components/TopNav";
import { StatusBadge } from "../editor/RunBits";
import { Select } from "../components/Field";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";
import { HistoryIcon, PlayIcon, SearchIcon, SpinnerIcon } from "../components/icons";
import { formatDuration, timeAgo } from "../lib/format";
import { navigate } from "../lib/router";
import { toast } from "../store/toasts";

const STATUSES: (ExecutionStatus | "all")[] = ["all", "queued", "running", "success", "failed"];
const TRIGGERS: (RunTriggerType | "all")[] = ["all", "manual", "webhook", "schedule"];
const RANGES = [
  { key: "1", label: "24h", days: 1 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: 0 },
];
const PAGE_SIZE = 25;

function rangeFrom(days: number): string | undefined {
  if (days <= 0) return undefined;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function RunsPage() {
  const workspace = useAuth((s) => s.workspace);

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [status, setStatus] = useState<ExecutionStatus | "all">("all");
  const [workflowId, setWorkflowId] = useState<string>("all");
  const [trigger, setTrigger] = useState<RunTriggerType | "all">("all");
  const [rangeKey, setRangeKey] = useState("7");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [runs, setRuns] = useState<WorkspaceRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped to force a re-fetch of the first page (used by the error-state retry).
  const [reloadToken, setReloadToken] = useState(0);
  // Increments on every filter change so in-flight pages from a stale query are ignored.
  const queryId = useRef(0);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  const buildFilters = useCallback(
    () => ({
      status: status === "all" ? undefined : status,
      workflowId: workflowId === "all" ? undefined : workflowId,
      trigger: trigger === "all" ? undefined : trigger,
      search: search || undefined,
      from: rangeFrom(RANGES.find((r) => r.key === rangeKey)?.days ?? 7),
      limit: PAGE_SIZE,
    }),
    [status, workflowId, trigger, search, rangeKey],
  );

  // (Re)load the first page whenever filters change.
  useEffect(() => {
    if (!workspace) return;
    const id = ++queryId.current;
    void (async () => {
      setRuns(null);
      setCursor(null);
      setError(null);
      try {
        const page = await runApi.listWorkspace(workspace.id, buildFilters());
        if (queryId.current !== id) return; // a newer query superseded this one
        setRuns(page.runs);
        setCursor(page.nextCursor);
      } catch (err) {
        if (queryId.current !== id) return;
        setError(errorMessage(err, "Could not load runs"));
      }
    })();
  }, [workspace, buildFilters, reloadToken]);

  const loadMore = useCallback(async () => {
    if (!workspace || !cursor || loadingMore) return;
    const id = queryId.current;
    setLoadingMore(true);
    try {
      const page = await runApi.listWorkspace(workspace.id, { ...buildFilters(), cursor });
      if (queryId.current !== id) return;
      setRuns((prev) => [...(prev ?? []), ...page.runs]);
      setCursor(page.nextCursor);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load more runs"));
    } finally {
      if (queryId.current === id) setLoadingMore(false);
    }
  }, [workspace, cursor, loadingMore, buildFilters]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "240px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

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
          <div className="relative min-w-[200px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-faint" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by workflow or run id"
              spellCheck={false}
              className="w-full rounded-lg border border-white/8 bg-surface/40 py-2 pl-9 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/60"
            />
          </div>
          <div className="w-[140px]">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ExecutionStatus | "all")}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[140px]">
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value as RunTriggerType | "all")}>
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All triggers" : t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-[180px]">
            <Select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
              <option value="all">All workflows</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-1 rounded-lg border border-white/8 p-0.5">
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

        {/* results */}
        {error ? (
          <div className="mt-5">
            <ErrorState title="Couldn’t load runs" message={error} onRetry={() => setReloadToken((t) => t + 1)} />
          </div>
        ) : runs && runs.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              icon={<HistoryIcon />}
              title="No runs match these filters"
              description="Adjust the filters above, or run a workflow to see its execution history here."
            />
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/8 bg-surface/40">
            {runs === null ? (
              <LoadingState className="py-16" />
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
                    onClick={() => navigate(`/runs/${run.id}`)}
                    className="cursor-pointer border-b border-white/5 transition-colors last:border-0 hover:bg-white/4"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{run.workflowName}</div>
                      <div className="flex items-center gap-2">
                        {run.replayOfId ? <span className="text-[11px] text-faint">replay</span> : null}
                        <span className="font-mono text-[10.5px] text-faint">{run.id.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                      {run.status === "failed" && run.failingNode ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/runs/${run.id}?node=${encodeURIComponent(run.failingNode!)}`);
                          }}
                          className="mt-1 block font-mono text-[10.5px] text-red-300/80 transition-colors hover:text-red-300"
                          title="Jump to the failing node"
                        >
                          ↯ {run.failingNode}
                        </button>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">{run.trigger}</td>
                    <td className="hidden px-4 py-3 font-mono text-[12px] text-muted md:table-cell">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </td>
                    <td className="px-4 py-3 text-muted">{run.createdAt ? timeAgo(run.createdAt) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <ReplayButton runId={run.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            )}
          </div>
        )}

        {/* infinite-scroll sentinel + manual fallback */}
        {runs && runs.length > 0 && cursor ? (
          <div ref={sentinelRef} className="flex justify-center py-6">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-60"
            >
              {loadingMore ? <SpinnerIcon className="animate-spin text-[14px]" /> : null}
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function ReplayButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  const replay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const fresh = await runApi.replay(runId);
      toast.success("Replay queued");
      navigate(`/runs/${fresh.id}`);
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/8 px-2 py-1 text-[11.5px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-60"
    >
      {busy ? <SpinnerIcon className="animate-spin text-[13px]" /> : <PlayIcon className="text-[13px]" />} Replay
    </button>
  );
}
