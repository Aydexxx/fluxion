import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { StatusBadge } from "./RunBits";
import { CloseIcon, HistoryIcon, SpinnerIcon } from "../components/icons";
import { formatDuration } from "../lib/format";

export function RunResultsBar() {
  const reduce = useReducedMotion();
  const running = useEditor((s) => s.running);
  const activeRun = useEditor((s) => s.activeRun);
  const replay = useEditor((s) => s.replay);
  const open = useEditor((s) => s.resultsOpen);
  const clearRun = useEditor((s) => s.clearRun);
  const setHistoryOpen = useEditor((s) => s.setHistoryOpen);

  const visible = open && (running || activeRun !== null);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
        >
          <div
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 glass"
            style={{ boxShadow: "0 24px 60px -24px rgba(0,0,0,0.9)" }}
          >
            {running ? (
              <RunningContent queued={activeRun?.status === "queued"} />
            ) : activeRun ? (
              <FinishedContent
                status={activeRun.status}
                duration={formatDuration(activeRun.startedAt, activeRun.finishedAt)}
                executed={activeRun.nodeExecutions.length}
                succeeded={activeRun.nodeExecutions.filter((n) => n.status === "success").length}
                error={activeRun.error}
                replay={replay}
              />
            ) : null}

            <div className="mx-0.5 h-6 w-px bg-white/10" />

            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-ink"
            >
              <HistoryIcon className="text-[14px]" /> History
            </button>
            <button
              type="button"
              aria-label="Dismiss run results"
              onClick={clearRun}
              className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <CloseIcon className="text-[15px]" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function RunningContent({ queued }: { queued: boolean }) {
  return (
    <div className="flex items-center gap-2.5 pl-1.5 pr-1">
      <SpinnerIcon className="animate-spin text-[15px] text-accent" />
      <span className="text-[13px] font-medium text-ink">{queued ? "Queued — waiting for a worker…" : "Running workflow…"}</span>
    </div>
  );
}

function FinishedContent({
  status,
  duration,
  executed,
  succeeded,
  error,
  replay,
}: {
  status: "queued" | "running" | "success" | "failed";
  duration: string;
  executed: number;
  succeeded: number;
  error: string | null;
  replay: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pl-1.5">
      <StatusBadge status={status} />
      <div className="flex flex-col">
        <div className="flex items-center gap-2 text-[12.5px] text-ink">
          <span className="font-mono text-[11.5px] text-muted">{duration}</span>
          <span className="text-faint">·</span>
          <span className="text-muted">
            {succeeded}/{executed} {executed === 1 ? "node" : "nodes"}
          </span>
          {replay ? <span className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-faint">Replay</span> : null}
        </div>
        {status === "failed" && error ? (
          <span className="mt-0.5 max-w-[340px] truncate text-[11.5px] text-[#ffb4b4]" title={error}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
