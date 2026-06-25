import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { confirm } from "../components/ui/confirm";
import { useToast } from "../components/ui/toast";
import { CloseIcon, LayersIcon, RotateIcon, SpinnerIcon } from "../components/icons";
import { EASE } from "../lib/motion";
import { timeAgo } from "../lib/format";
import type { DefinitionDiff, WorkflowVersionSummary } from "../lib/types";

export function VersionHistoryDrawer() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const open = useEditor((s) => s.versionHistoryOpen);
  const versions = useEditor((s) => s.versions);
  const loading = useEditor((s) => s.versionsLoading);
  const publishedVersion = useEditor((s) => s.publishedVersion);
  const setOpen = useEditor((s) => s.setVersionHistoryOpen);
  const previewVersionById = useEditor((s) => s.previewVersionById);
  const rollbackTo = useEditor((s) => s.rollbackTo);

  const preview = async (v: WorkflowVersionSummary) => {
    setOpen(false);
    const res = await previewVersionById(v.id);
    if (!res.ok) toast.error(res.message ?? "Could not open version");
  };

  const restore = async (v: WorkflowVersionSummary) => {
    const ok = await confirm({
      title: `Roll back to v${v.version}?`,
      body: (
        <>
          This makes <span className="text-ink">v{v.version}</span> the live published version and your current draft.
          A new version is recorded — nothing is lost.
        </>
      ),
      confirmLabel: "Roll back",
    });
    if (!ok) return;
    const id = toast.loading("Rolling back…");
    const res = await rollbackTo(v.id);
    toast.update(id, res.ok ? { kind: "success", message: `Rolled back to v${v.version}` } : { kind: "error", message: res.message ?? "Could not roll back" });
  };

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
            onClick={() => setOpen(false)}
            className="absolute inset-0 z-30 bg-base/40 backdrop-blur-[2px]"
          />
          <motion.aside
            key="drawer"
            initial={reduce ? { opacity: 0 } : { x: 380, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 380, opacity: 0 }}
            transition={{ duration: 0.36, ease: EASE }}
            className="absolute right-3 top-3 bottom-3 z-40 flex w-[360px] flex-col overflow-hidden rounded-2xl glass"
            style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)" }}
          >
            <div className="flex items-center justify-between border-b border-white/8 p-4">
              <div className="flex items-center gap-2">
                <LayersIcon className="text-[16px] text-accent" />
                <h2 className="font-display text-[15px] font-semibold text-ink">Version history</h2>
              </div>
              <button
                type="button"
                aria-label="Close version history"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5">
              {loading && versions.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-muted">
                  <SpinnerIcon className="animate-spin text-[16px]" />
                  <span className="text-[13px]">Loading versions…</span>
                </div>
              ) : versions.length === 0 ? (
                <p className="px-2 py-10 text-center text-[13px] leading-relaxed text-muted">
                  No versions yet. Hit <span className="text-ink">Publish</span> to snapshot your first version and go live.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {versions.map((v, i) => (
                    <VersionRow
                      key={v.id}
                      version={v}
                      index={i}
                      reduce={!!reduce}
                      isCurrent={v.version === publishedVersion}
                      onView={() => void preview(v)}
                      onRestore={() => void restore(v)}
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

function VersionRow({
  version,
  index,
  reduce,
  isCurrent,
  onView,
  onRestore,
}: {
  version: WorkflowVersionSummary;
  index: number;
  reduce: boolean;
  isCurrent: boolean;
  onView: () => void;
  onRestore: () => void;
}) {
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: reduce ? 0 : Math.min(index * 0.03, 0.25) }}
    >
      <div
        className="group rounded-xl border px-3 py-2.5 transition-colors"
        style={{
          borderColor: isCurrent ? "color-mix(in oklab, #34d0a8 45%, transparent)" : "color-mix(in oklab, white 8%, transparent)",
          background: isCurrent ? "color-mix(in oklab, #34d0a8 8%, transparent)" : "color-mix(in oklab, white 2%, transparent)",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-ink">v{version.version}</span>
            {isCurrent ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "#34d0a8", background: "color-mix(in oklab, #34d0a8 14%, transparent)" }}
              >
                Live
              </span>
            ) : null}
          </div>
          <span className="text-[11px] text-faint">{timeAgo(version.createdAt)}</span>
        </div>

        {version.note ? <p className="mt-1 text-[12.5px] text-muted">{version.note}</p> : null}

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-faint">
          {version.authorName ? <span>{version.authorName}</span> : null}
          {version.authorName ? <span>·</span> : null}
          <span>{version.nodeCount} node{version.nodeCount === 1 ? "" : "s"}</span>
        </div>

        <DiffSummary diff={version.diff} />

        <div className="mt-2.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onView}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
          >
            View
          </button>
          {!isCurrent ? (
            <button
              type="button"
              onClick={onRestore}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              <RotateIcon className="text-[12px]" /> Roll back
            </button>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

/** A compact "+a −r ~c" chip row describing the diff vs the previous version. */
function DiffSummary({ diff }: { diff: DefinitionDiff }) {
  const parts: { label: string; color: string }[] = [];
  if (diff.addedNodes.length) parts.push({ label: `+${diff.addedNodes.length} added`, color: "#34d0a8" });
  if (diff.removedNodes.length) parts.push({ label: `−${diff.removedNodes.length} removed`, color: "#e0686b" });
  if (diff.changedNodes.length) parts.push({ label: `~${diff.changedNodes.length} changed`, color: "#e0a33e" });
  const edgeDelta = diff.edgesAdded + diff.edgesRemoved;
  if (edgeDelta) parts.push({ label: `${edgeDelta} edge${edgeDelta === 1 ? "" : "s"}`, color: "#4c9bff" });

  if (parts.length === 0) {
    return <p className="mt-2 text-[11px] text-faint">No structural changes.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {parts.map((p) => (
        <span
          key={p.label}
          className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium"
          style={{ color: p.color, background: `color-mix(in oklab, ${p.color} 12%, transparent)` }}
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}
