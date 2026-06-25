import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../store/auth";
import { analyticsApi, errorMessage } from "../lib/api";
import type { AnalyticsResult } from "../lib/types";
import { TopNav } from "../components/TopNav";
import { ChartIcon } from "../components/icons";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/states";

const SUCCESS = "#34d0a8";
const FAILED = "#ff6b6b";
const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
];

const tooltipStyle = {
  background: "rgba(18,18,24,0.92)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  fontSize: 12,
  color: "#e8e8f0",
};

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function AnalyticsPage() {
  const reduce = useReducedMotion();
  const workspace = useAuth((s) => s.workspace);
  const [rangeKey, setRangeKey] = useState("30");
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!workspace) return () => {};
    let alive = true;
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30;
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await analyticsApi.get(workspace.id, { from });
        if (alive) setData(d);
      } catch (err) {
        if (alive) setError(errorMessage(err, "Could not load analytics"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspace, rangeKey]);

  useEffect(() => load(), [load]);

  const pieData = data ? [
    { name: "Success", value: data.summary.success, color: SUCCESS },
    { name: "Failed", value: data.summary.failed, color: FAILED },
  ] : [];
  const hasTerminal = data ? data.summary.success + data.summary.failed > 0 : false;

  return (
    <div className="relative h-screen overflow-y-auto bg-base">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[360px] bloom opacity-70" />
      <TopNav active="analytics" />

      <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] font-semibold tracking-tight text-gradient">Analytics</h1>
            <p className="mt-1 text-sm text-muted">Execution health across your workspace.</p>
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

        {error && !data ? (
          <ErrorState title="Couldn’t load analytics" message={error} onRetry={load} />
        ) : loading && !data ? (
          <LoadingState label="Crunching your run history…" />
        ) : !data || data.summary.total === 0 ? (
          <EmptyState
            icon={<ChartIcon />}
            title="No analytics yet"
            description="Once your workflows start running, you’ll see success rates, throughput over time, and your most error-prone nodes here."
          />
        ) : (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mt-7 space-y-5"
          >
            {/* stat cards */}
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <StatCard label="Total runs" value={String(data.summary.total)} />
              <StatCard label="Success rate" value={`${data.summary.successRate}%`} accent={SUCCESS} />
              <StatCard label="Failed runs" value={String(data.summary.failed)} accent={data.summary.failed > 0 ? FAILED : undefined} />
              <StatCard label="Avg duration" value={fmtDuration(data.summary.avgDurationMs)} />
            </div>

            {/* runs over time */}
            <Panel title="Runs over time">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.runsOverTime} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={SUCCESS} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={FAILED} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={FAILED} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} stroke="#6b6b78" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke="#6b6b78" fontSize={11} tickLine={false} axisLine={false} width={28} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#9a9aa8" }} />
                    <Area type="monotone" dataKey="success" stroke={SUCCESS} strokeWidth={2} fill="url(#gSuccess)" name="Success" />
                    <Area type="monotone" dataKey="failed" stroke={FAILED} strokeWidth={2} fill="url(#gFailed)" name="Failed" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* success vs failure donut */}
              <Panel title="Success vs failure">
                <div className="flex h-[240px] items-center">
                  {hasTerminal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                          {pieData.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="w-full text-center text-[13px] text-muted">No completed runs yet.</p>
                  )}
                </div>
              </Panel>

              {/* most-failing workflows */}
              <Panel title="Most-failing workflows">
                {data.topFailingWorkflows.length === 0 ? (
                  <p className="py-16 text-center text-[13px] text-muted">No failures in this period 🎉</p>
                ) : (
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.topFailingWorkflows}
                        layout="vertical"
                        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                      >
                        <XAxis type="number" allowDecimals={false} stroke="#6b6b78" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={110} stroke="#9a9aa8" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                        <Bar dataKey="failures" fill={FAILED} radius={[0, 5, 5, 0]} barSize={16} name="Failures" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
            </div>

            {/* most-failing nodes */}
            <Panel title="Most-failing nodes">
              {data.topFailingNodes.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted">No node failures in this period.</p>
              ) : (
                <ul className="divide-y divide-white/6">
                  {data.topFailingNodes.map((n) => (
                    <li key={`${n.workflowId}:${n.nodeId}`} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <span className="font-mono text-[12.5px] text-ink">{n.nodeId}</span>
                        <span className="ml-2 text-[12px] text-faint">{n.workflowName}</span>
                      </div>
                      <span className="rounded-full bg-red-500/12 px-2.5 py-0.5 text-[12px] font-medium text-red-300">
                        {n.failures} {n.failures === 1 ? "failure" : "failures"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </motion.div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-surface/50 p-4">
      <div className="text-[11px] uppercase tracking-[0.13em] text-faint">{label}</div>
      <div className="mt-2 font-display text-[26px] font-semibold tracking-tight" style={{ color: accent ?? "var(--color-ink)" }}>
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-surface/40 p-4">
      <h3 className="mb-3 text-[12.5px] font-medium uppercase tracking-[0.1em] text-muted">{title}</h3>
      {children}
    </div>
  );
}
