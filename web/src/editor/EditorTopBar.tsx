import { motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { navigate } from "../lib/router";
import { useToast } from "../components/ui/toast";
import { ChevronRightIcon, HistoryIcon, Logo, PlayIcon, SaveIcon, SearchIcon, SpinnerIcon } from "../components/icons";

export function EditorTopBar() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const name = useEditor((s) => s.name);
  const isActive = useEditor((s) => s.isActive);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const running = useEditor((s) => s.running);
  const setName = useEditor((s) => s.setName);
  const setActive = useEditor((s) => s.setActive);
  const save = useEditor((s) => s.save);
  const run = useEditor((s) => s.run);
  const setHistoryOpen = useEditor((s) => s.setHistoryOpen);
  const setCommandPaletteOpen = useEditor((s) => s.setCommandPaletteOpen);

  const handleRun = async () => {
    const id = toast.loading("Starting run…");
    const res = await run();
    if (!res.ok) {
      toast.update(id, { kind: "error", message: res.message ?? "Could not run workflow" });
      return;
    }
    // The run is now queued; the worker executes it and live events drive the
    // canvas + a completion toast (see editorStore.applyLiveEvent).
    toast.update(id, { kind: "info", message: "Run queued" });
  };

  const handleSave = async () => {
    const res = await save();
    if (!res.ok) {
      toast.error(res.message ?? "Could not save");
      return;
    }
    const warnings = useEditor.getState().warnings;
    toast.success("Workflow saved");
    for (const w of warnings.slice(0, 2)) toast.info(w);
  };

  // Save / undo / redo / palette shortcuts are owned by useEditorShortcuts.

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/8 bg-surface/60 px-3 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted transition-colors hover:bg-white/5 hover:text-ink"
        aria-label="Back to workflows"
      >
        <Logo className="text-[17px] text-accent" />
        <ChevronRightIcon className="text-[15px] text-faint" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          placeholder="Untitled workflow"
          className="min-w-0 max-w-[420px] flex-1 truncate rounded-md bg-transparent px-1.5 py-1 font-display text-[15px] font-semibold text-ink outline-none transition-colors hover:bg-white/[0.03] focus:bg-white/5 placeholder:text-faint"
        />
        <SaveState dirty={dirty} saving={saving} />
      </div>

      <ActiveToggle active={isActive} onToggle={() => setActive(!isActive)} reduce={!!reduce} />

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        aria-label="Open command palette"
        title="Command palette"
        className="flex items-center gap-2 rounded-lg border border-white/8 py-1.5 pl-2.5 pr-2 text-[13px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink"
      >
        <SearchIcon className="text-[14px]" />
        <kbd className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-faint">⌘K</kbd>
      </button>

      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        aria-label="Run history"
        className="flex items-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink"
      >
        <HistoryIcon className="text-[14px]" /> History
      </button>

      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="flex items-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink disabled:opacity-70"
      >
        {running ? <SpinnerIcon className="animate-spin text-[13px]" /> : <PlayIcon className="text-[11px]" />}
        {running ? "Running" : "Run"}
      </button>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all disabled:opacity-70"
        style={{
          background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
          boxShadow: "0 6px 20px -6px color-mix(in oklab, var(--color-accent) 70%, transparent)",
        }}
      >
        {saving ? <SpinnerIcon className="animate-spin text-[14px]" /> : <SaveIcon className="text-[14px]" />}
        {saving ? "Saving" : "Save"}
      </button>
    </header>
  );
}

function SaveState({ dirty, saving }: { dirty: boolean; saving: boolean }) {
  const label = saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved";
  return (
    <span className="hidden items-center gap-1.5 whitespace-nowrap text-[11.5px] text-faint sm:flex">
      <span
        className="size-1.5 rounded-full transition-colors"
        style={{ background: dirty || saving ? "var(--color-accent)" : "color-mix(in oklab, white 22%, transparent)" }}
      />
      {label}
    </span>
  );
}

function ActiveToggle({ active, onToggle, reduce }: { active: boolean; onToggle: () => void; reduce: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className="flex items-center gap-2 rounded-lg border border-white/8 py-1.5 pl-2.5 pr-2 transition-colors hover:border-white/14"
    >
      <span className="text-[12px] font-medium" style={{ color: active ? "var(--color-cat-output)" : "var(--color-faint)" }}>
        {active ? "Active" : "Inactive"}
      </span>
      <span
        className="relative h-[18px] w-[32px] rounded-full transition-colors duration-200"
        style={{ background: active ? "color-mix(in oklab, #34d0a8 80%, transparent)" : "color-mix(in oklab, white 14%, transparent)" }}
      >
        <motion.span
          layout={!reduce}
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
          className="absolute top-[2px] size-[14px] rounded-full bg-white shadow"
          style={{ left: active ? 16 : 2 }}
        />
      </span>
    </button>
  );
}
