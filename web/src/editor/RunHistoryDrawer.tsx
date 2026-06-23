import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { StatusBadge } from "./RunBits";
import { statusVisual, toNodeRunStatus } from "./runStatus";
import { CloseIcon, HistoryIcon, SpinnerIcon } from "../components/icons";
import { EASE } from "../lib/motion";
import { formatDuration, timeAgo } from "../lib/format";
import type { RunSummary } from "../lib/types";

export function RunHistoryDrawer() {
  const reduce = useReducedMotion();
  const open = useEditor((s) => s.historyOpen);
  const runs = useEditor((s) => s.runs);
  const loading = useEditor((s) => s.runsLoading);
  const activeRunId = useEditor((s) => s.activeRun?.id ?? null);
  const setHistoryOpen = useEditor((s) => s.setHistoryOpen);
  const loadRunResult = useEditor((s) => s.loadRunResult);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setHistoryOpen(false)}
            className="absolute inset-0 z-30 bg-base/40 backdrop-blur-[2px]"
          />
          <motion.aside
            key="drawer"
            initial={reduce ? { opacity: 0 } : { x: 360, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 360, opacity: 0 }}
            transition={{ duration: 0.36, ease: EASE }}
            className="absolute right-3 top-3 bottom-3 z-40 flex w-[340px] flex-col overflow-hidden rounded-2xl glass"
            style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)" }}
          >
            <div className="flex items-center justify-between border-b border-white/8 p-4">
              <div className="flex items-center gap-2">
                <HistoryIcon className="text-[16px] text-accent" />
                <h2 className="font-display text-[15px] font-semibold text-ink">Run history</h2>
              </div>
              <button
                type="button"
                aria-label="Close history"
                onClick={() => setHistoryOpen(false)}
                className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5">
              {loading && runs.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-muted">
                  <SpinnerIcon className="animate-spin text-[16px]" />
                  <span className="text-[13px]">Loading runs…</span>
                </div>
              ) : runs.length === 0 ? (
                <p className="px-2 py-10 text-center text-[13px] leading-relaxed text-muted">
                  No runs yet. Hit <span className="text-ink">Run</span> to execute this workflow.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {runs.map((run, i) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      index={i}
                      active={run.id === activeRunId}
                      reduce={!!reduce}
                      onClick={() => void loadRunResult(run.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function RunRow({
  run,
  index,
  active,
  reduce,
  onClick,
}: {
  run: RunSummary;
  index: number;
  active: boolean;
  reduce: boolean;
  onClick: () => void;
}) {
  const color = statusVisual(toNodeRunStatus(run.status)).color;
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: reduce ? 0 : Math.min(index * 0.03, 0.25) }}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-xl border px-3 py-2.5 text-left transition-colors"
        style={{
          borderColor: active ? `color-mix(in oklab, ${color} 45%, transparent)` : "color-mix(in oklab, white 8%, transparent)",
          background: active ? `color-mix(in oklab, ${color} 9%, transparent)` : "color-mix(in oklab, white 2%, transparent)",
        }}
      >
        <div className="flex items-center justify-between">
          <StatusBadge status={run.status} />
          <span className="font-mono text-[11px] text-faint">{formatDuration(run.startedAt, run.finishedAt)}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted">
          <span className="capitalize">{run.trigger}</span>
          <span className="text-faint">·</span>
          <span>{run.startedAt ? timeAgo(run.startedAt) : "—"}</span>
        </div>
      </button>
    </motion.li>
  );
}
