import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { sendEditing, usePresence } from "./presence";
import { getConfigForm, ErrorHandlingForm } from "./configForms";
import { categoryAccent, getNodeSpec } from "./nodeCatalog";
import { JsonBlock, StatusBadge } from "./RunBits";
import type { FluxNode } from "./graph";
import { CloseIcon, PlayIcon, SparkIcon, SpinnerIcon, TrashIcon } from "../components/icons";
import { EASE } from "../lib/motion";
import { formatDuration } from "../lib/format";
import { toast } from "../store/toasts";
import type { NodeExecution } from "../lib/types";

export function ConfigPanel() {
  const reduce = useReducedMotion();
  const selectedId = useEditor((s) => s.selectedNodeId);
  const node = useEditor((s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null);
  const updateNodeConfig = useEditor((s) => s.updateNodeConfig);
  const updateNodeTitle = useEditor((s) => s.updateNodeTitle);
  const deleteNode = useEditor((s) => s.deleteNode);
  const selectNode = useEditor((s) => s.selectNode);

  const open = Boolean(selectedId && node);

  return (
    <AnimatePresence>
      {open && node ? (
        <motion.aside
          key={node.id}
          initial={reduce ? { opacity: 0 } : { x: 24, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: 24, opacity: 0 }}
          transition={{ duration: 0.34, ease: EASE }}
          className="absolute right-3 top-3 bottom-3 z-20 flex w-[336px] flex-col overflow-hidden rounded-2xl glass"
          style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)" }}
        >
          <PanelInner
            key={node.id}
            node={node}
            onTitle={(t) => updateNodeTitle(node.id, t)}
            onConfig={(c) => updateNodeConfig(node.id, c)}
            onDelete={() => deleteNode(node.id)}
            onClose={() => selectNode(null)}
          />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function PanelInner({
  node,
  onTitle,
  onConfig,
  onDelete,
  onClose,
}: {
  node: NonNullable<ReturnType<typeof useEditor.getState>["nodes"][number]>;
  onTitle: (title: string) => void;
  onConfig: (config: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const spec = getNodeSpec(node.data.nodeType);
  const accent = categoryAccent(node.data.nodeType);
  // getConfigForm looks up a stable component reference from a static registry
  // keyed by node type; it never creates a new component, so identity is
  // stable across renders despite being resolved during render.
  const Form = getConfigForm(node.data.nodeType);
  const Icon = spec.icon;

  const tab = useEditor((s) => s.inspectorTab);
  const setTab = useEditor((s) => s.setInspectorTab);

  // Soft-lock: tell peers we're editing this node's config (and release on close
  // or when switching away from the Config tab). Non-blocking — purely advisory.
  useEffect(() => {
    sendEditing(tab === "config" ? node.id : null);
    return () => sendEditing(null);
  }, [node.id, tab]);

  const hasRun = useEditor((s) => s.activeRun !== null);
  const execution = useEditor(
    (s) => s.activeRun?.nodeExecutions.find((e) => e.nodeId === node.id) ?? null,
  );
  const hasTest = useEditor((s) => Boolean(s.nodeTests[node.id]) || node.data.pinned !== undefined);

  return (
    <>
      {/* header */}
      <div className="relative border-b border-white/8 p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[20px]"
            style={{
              color: accent,
              background: `color-mix(in oklab, ${accent} 15%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 28%, transparent)`,
            }}
          >
            <Icon />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: accent }}>
              {spec.label}
            </div>
            <input
              value={node.data.title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder={spec.defaultTitle}
              spellCheck={false}
              className="mt-0.5 w-full bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-faint"
            />
          </div>
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {/* tabs */}
        <div className="mt-3.5 flex gap-1">
          <Tab label="Config" active={tab === "config"} onClick={() => setTab("config")} />
          <Tab label="Test" active={tab === "test"} onClick={() => setTab("test")} dot={hasTest} />
          <Tab label="Last run" active={tab === "lastrun"} onClick={() => setTab("lastrun")} dot={hasRun} />
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto p-4">
        <EditLockBanner nodeId={node.id} />
        {tab === "config" ? (
          <div className="space-y-5">
            {Form ? (
              // Form is a stable lookup from a static registry (see getConfigForm above), not a fresh component.
              // eslint-disable-next-line react-hooks/static-components
              <Form nodeId={node.id} config={node.data.config} onChange={onConfig} />
            ) : (
              <p className="text-sm text-muted">This node has no configurable settings.</p>
            )}
            {/* Triggers don't run executors that fail in a catchable way; every other node gets error handling. */}
            {spec.hasInput ? (
              <div className="space-y-3 border-t border-white/8 pt-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Error handling</div>
                <ErrorHandlingForm config={node.data.config} onChange={onConfig} canRoute={spec.hasOutput} />
              </div>
            ) : null}
          </div>
        ) : tab === "test" ? (
          <TestNodeTab node={node} />
        ) : (
          <LastRunTab execution={execution} hasRun={hasRun} />
        )}
      </div>

      {/* footer */}
      <div className="border-t border-white/8 p-3">
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
        >
          <TrashIcon /> Delete node
        </button>
      </div>
    </>
  );
}

/**
 * Non-blocking advisory shown when another collaborator is editing this same
 * node, so two people don't silently clobber each other's config.
 */
function EditLockBanner({ nodeId }: { nodeId: string }) {
  const lockedBy = usePresence((s) => {
    for (const [socketId, editingId] of Object.entries(s.editing)) {
      if (editingId === nodeId) return s.participants[socketId] ?? null;
    }
    return null;
  });
  if (!lockedBy) return null;

  return (
    <div
      className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium"
      style={{
        borderColor: `color-mix(in oklab, ${lockedBy.color} 45%, transparent)`,
        background: `color-mix(in oklab, ${lockedBy.color} 12%, transparent)`,
        color: lockedBy.color,
      }}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: lockedBy.color }} />
        <span className="relative inline-flex size-2 rounded-full" style={{ background: lockedBy.color }} />
      </span>
      {lockedBy.name} is editing this node
    </div>
  );
}

function Tab({ label, active, onClick, dot }: { label: string; active: boolean; onClick: () => void; dot?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors"
      style={{
        color: active ? "var(--color-ink)" : "var(--color-faint)",
        background: active ? "color-mix(in oklab, white 6%, transparent)" : "transparent",
      }}
    >
      {label}
      {dot ? <span className="ml-1.5 inline-block size-1.5 -translate-y-0.5 rounded-full bg-accent" /> : null}
    </button>
  );
}

function LastRunTab({ execution, hasRun }: { execution: NodeExecution | null; hasRun: boolean }) {
  if (!hasRun) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        Run this workflow to capture each node’s input and output here.
      </p>
    );
  }
  if (!execution) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        This node didn’t execute in the last run — an upstream branch may have skipped it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <StatusBadge status={execution.status} />
        <span className="font-mono text-[11px] text-faint">{formatDuration(execution.startedAt, execution.finishedAt)}</span>
      </div>
      {execution.error ? <JsonBlock label="Error" value={execution.error} tone="error" /> : null}
      <JsonBlock label="Input" value={execution.input} />
      <JsonBlock label="Output" value={execution.output} />
    </div>
  );
}

/**
 * "Test" tab: run this single node in isolation against upstream sample data, and
 * pin mock output so downstream nodes can be built before this one has real data.
 */
function TestNodeTab({ node }: { node: FluxNode }) {
  const testNode = useEditor((s) => s.testNode);
  const clearNodeTest = useEditor((s) => s.clearNodeTest);
  const testing = useEditor((s) => s.testingNodeId === node.id);
  const result = useEditor((s) => s.nodeTests[node.id] ?? null);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void testNode(node.id)}
          disabled={testing}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/12 px-3 py-2 text-[13px] font-medium text-accent-bright transition-colors hover:bg-accent/20 disabled:opacity-60"
        >
          {testing ? <SpinnerIcon className="animate-spin text-[15px]" /> : <PlayIcon className="text-[14px]" />}
          {testing ? "Running…" : "Test this node"}
        </button>
        <p className="text-[11.5px] leading-relaxed text-faint">
          Runs just this node using upstream nodes’ last-run output or pinned sample data — without running the whole
          workflow.
        </p>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <StatusBadge status={result.status} />
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-faint">{result.durationMs} ms</span>
              <button
                type="button"
                onClick={() => clearNodeTest(node.id)}
                className="rounded px-1.5 text-[11px] text-faint transition-colors hover:text-ink"
              >
                clear
              </button>
            </div>
          </div>
          {result.error ? <JsonBlock label="Error" value={result.error} tone="error" /> : null}
          <JsonBlock label="Input" value={result.input} />
          {result.status === "success" ? <JsonBlock label="Output" value={result.output} /> : null}
          {result.status === "success" ? <PinFromOutput node={node} output={result.output} /> : null}
        </div>
      ) : null}

      <PinnedDataSection node={node} />
    </div>
  );
}

/** A one-click affordance to pin a successful test's output as the node's sample data. */
function PinFromOutput({ node, output }: { node: FluxNode; output: unknown }) {
  const setNodePinned = useEditor((s) => s.setNodePinned);
  const alreadyPinned = JSON.stringify(node.data.pinned) === JSON.stringify(output);
  if (alreadyPinned) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setNodePinned(node.id, output);
        toast.success("Pinned this output as sample data");
      }}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/8 px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-cat-logic/40 hover:text-ink"
    >
      <SparkIcon className="text-[13px]" /> Pin this output as sample data
    </button>
  );
}

/** Editor for the node's pinned sample output (paste/replace/clear JSON). */
function PinnedDataSection({ node }: { node: FluxNode }) {
  const setNodePinned = useEditor((s) => s.setNodePinned);
  const pinned = node.data.pinned;
  const hasPin = pinned !== undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(hasPin ? JSON.stringify(pinned, null, 2) : "");
    setEditing(true);
  };

  const savePin = () => {
    const text = draft.trim();
    if (text === "") {
      toast.error("Enter JSON to pin, or cancel");
      return;
    }
    try {
      setNodePinned(node.id, JSON.parse(text));
      setEditing(false);
      toast.success("Sample data pinned");
    } catch {
      toast.error("That isn’t valid JSON");
    }
  };

  return (
    <div className="rounded-xl border border-white/8 bg-void/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Pinned sample data</span>
        {hasPin ? (
          <span className="rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide" style={{ color: "#e0a33e", background: "rgba(224,163,62,0.12)" }}>
            pinned
          </span>
        ) : null}
      </div>

      {!editing ? (
        <div className="mt-2 space-y-2">
          {hasPin ? <JsonBlock label="Pinned output" value={pinned} /> : (
            <p className="text-[11.5px] leading-relaxed text-faint">
              Pin mock output so downstream nodes can map fields and run tests before this node has produced real data.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startEdit}
              className="flex-1 rounded-lg border border-white/8 px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-white/14 hover:text-ink"
            >
              {hasPin ? "Edit pin" : "Pin sample data"}
            </button>
            {hasPin ? (
              <button
                type="button"
                onClick={() => {
                  setNodePinned(node.id, undefined);
                  toast.success("Pin removed");
                }}
                className="rounded-lg border border-white/8 px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-red-500/30 hover:text-red-300"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={'{\n  "id": 123,\n  "title": "Sample"\n}'}
            className="w-full resize-none rounded-lg border border-white/8 bg-void/60 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent/70"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={savePin}
              className="flex-1 rounded-lg border border-accent/30 bg-accent/12 px-3 py-1.5 text-[12px] font-medium text-accent-bright transition-colors hover:bg-accent/20"
            >
              Pin as sample output
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-white/8 px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
