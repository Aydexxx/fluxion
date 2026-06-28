import { motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { PresenceAvatars } from "./PresenceAvatars";
import { navigate } from "../lib/router";
import { useAuth } from "../store/auth";
import { canEdit as roleCanEdit } from "../lib/permissions";
import { useToast } from "../components/ui/toast";
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  GridIcon,
  HistoryIcon,
  LayersIcon,
  Logo,
  PlayIcon,
  RotateIcon,
  SaveIcon,
  SearchIcon,
  SpinnerIcon,
  UploadIcon,
} from "../components/icons";

/** Whether the current user may edit/run/publish the open workflow (its workspace role). */
function useCanEditWorkflow(): boolean {
  const workspaceId = useEditor((s) => s.workspaceId);
  const workspaces = useAuth((s) => s.workspaces);
  return roleCanEdit(workspaces.find((w) => w.id === workspaceId)?.role);
}

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
  const previewVersion = useEditor((s) => s.previewVersion);
  const canEdit = useCanEditWorkflow();

  // While previewing a past version the editor is read-only; show a focused banner instead.
  if (previewVersion) return <PreviewBanner />;

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

  const handlePublish = async () => {
    const id = toast.loading("Publishing…");
    const res = await useEditor.getState().publish();
    if (!res.ok) {
      toast.update(id, { kind: "error", message: res.message ?? "Could not publish" });
      return;
    }
    const version = useEditor.getState().publishedVersion;
    toast.update(id, { kind: "success", message: version ? `Published v${version} — now live` : "Published — now live" });
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
          readOnly={!canEdit}
          spellCheck={false}
          placeholder="Untitled workflow"
          className="min-w-0 max-w-[360px] flex-1 truncate rounded-md bg-transparent px-1.5 py-1 font-display text-[15px] font-semibold text-ink outline-none transition-colors hover:bg-white/[0.03] focus:bg-white/5 placeholder:text-faint read-only:hover:bg-transparent"
        />
        <SaveState dirty={dirty} saving={saving} />
        <PublishBadge />
      </div>

      <PresenceAvatars />

      {canEdit ? <ActiveToggle active={isActive} onToggle={() => setActive(!isActive)} reduce={!!reduce} /> : <ViewerBadge />}

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
        onClick={() => useEditor.getState().setVersionHistoryOpen(true)}
        aria-label="Version history"
        className="flex items-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink"
      >
        <LayersIcon className="text-[14px]" /> Versions
      </button>

      {canEdit ? <FailureAlertButton /> : null}

      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        aria-label="Run history"
        className="flex items-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink"
      >
        <HistoryIcon className="text-[14px]" /> Runs
      </button>

      {canEdit ? (
        <>
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
            className="flex items-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink disabled:opacity-70"
          >
            {saving ? <SpinnerIcon className="animate-spin text-[13px]" /> : <SaveIcon className="text-[13px]" />}
            {saving ? "Saving" : "Save"}
          </button>

          <PublishButton onPublish={handlePublish} />
        </>
      ) : null}
    </header>
  );
}

/** Primary action: promote the saved draft to the live published version. */
function PublishButton({ onPublish }: { onPublish: () => void }) {
  const publishing = useEditor((s) => s.publishing);
  const hasUnpublishedChanges = useEditor((s) => s.hasUnpublishedChanges);
  const dirty = useEditor((s) => s.dirty);
  const publishedVersion = useEditor((s) => s.publishedVersion);
  // There's something to publish if the draft is unsaved, or differs from published.
  const canPublish = dirty || hasUnpublishedChanges || publishedVersion === null;

  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || !canPublish}
      title={canPublish ? "Promote this draft to the live version" : "Nothing new to publish"}
      className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
        boxShadow: "0 6px 20px -6px color-mix(in oklab, var(--color-accent) 70%, transparent)",
      }}
    >
      {publishing ? <SpinnerIcon className="animate-spin text-[14px]" /> : <UploadIcon className="text-[14px]" />}
      {publishing ? "Publishing" : "Publish"}
    </button>
  );
}

/** Shown in place of the edit actions when the user only has read access. */
function ViewerBadge() {
  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[12px] font-medium"
      style={{
        borderColor: "color-mix(in oklab, #8d8d99 35%, transparent)",
        color: "var(--color-muted)",
        background: "color-mix(in oklab, #8d8d99 8%, transparent)",
      }}
      title="You have read-only access to this workspace"
    >
      <GridIcon className="text-[13px]" /> Read-only
    </span>
  );
}

/** Opens the failure-alert config; lit when an alert is configured. */
function FailureAlertButton() {
  const failureNotify = useEditor((s) => s.failureNotify);
  const setOpen = useEditor((s) => s.setFailureAlertOpen);
  const on = failureNotify !== null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Failure alert"
      title={on ? `Failure alert: ${failureNotify.channel}` : "Configure a failure alert"}
      className="relative flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors"
      style={{
        borderColor: on ? "color-mix(in oklab, #e0a33e 45%, transparent)" : "color-mix(in oklab, white 8%, transparent)",
        color: on ? "#e0a33e" : "var(--color-muted)",
        background: on ? "color-mix(in oklab, #e0a33e 10%, transparent)" : "transparent",
      }}
    >
      <AlertIcon className="text-[15px]" />
    </button>
  );
}

/** Shows whether the live version is up to date with the draft. */
function PublishBadge() {
  const hasUnpublishedChanges = useEditor((s) => s.hasUnpublishedChanges);
  const publishedVersion = useEditor((s) => s.publishedVersion);
  const dirty = useEditor((s) => s.dirty);

  const unpublished = hasUnpublishedChanges || dirty || publishedVersion === null;
  const color = unpublished ? "#e0a33e" : "#34d0a8";
  const label =
    publishedVersion === null
      ? "Not published"
      : unpublished
        ? `Unpublished changes · live v${publishedVersion}`
        : `Published · v${publishedVersion}`;

  return (
    <span
      className="hidden items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium md:inline-flex"
      style={{ color, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
      title={label}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Replaces the whole top bar while a past version is open read-only. */
function PreviewBanner() {
  const toast = useToast();
  const previewVersion = useEditor((s) => s.previewVersion);
  const exitPreview = useEditor((s) => s.exitPreview);
  const rollbackTo = useEditor((s) => s.rollbackTo);
  if (!previewVersion) return null;

  const restore = async () => {
    const id = toast.loading("Restoring version…");
    const res = await rollbackTo(previewVersion.id);
    toast.update(id, res.ok ? { kind: "success", message: `Restored v${previewVersion.version}` } : { kind: "error", message: res.message ?? "Could not restore" });
  };

  return (
    <header
      className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-xl"
      style={{ borderColor: "color-mix(in oklab, #e0a33e 40%, transparent)", background: "color-mix(in oklab, #e0a33e 8%, var(--color-surface))" }}
    >
      <LayersIcon className="text-[17px]" style={{ color: "#e0a33e" }} />
      <div className="min-w-0 flex-1">
        <span className="text-[13.5px] font-semibold text-ink">
          Viewing version {previewVersion.version}
          {previewVersion.isCurrent ? " (current)" : ""}
        </span>
        <span className="ml-2 text-[12px] text-muted">Read-only · {previewVersion.note ?? "snapshot"}</span>
      </div>
      <button
        type="button"
        onClick={restore}
        disabled={previewVersion.isCurrent}
        className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all disabled:opacity-50"
        style={{ background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" }}
      >
        <RotateIcon className="text-[14px]" /> Restore this version
      </button>
      <button
        type="button"
        onClick={exitPreview}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <CloseIcon className="text-[13px]" /> Exit
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
