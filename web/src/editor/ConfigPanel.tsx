import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { getConfigForm } from "./configForms";
import { categoryAccent, getNodeSpec } from "./nodeCatalog";
import { JsonBlock, StatusBadge } from "./RunBits";
import { CloseIcon, TrashIcon } from "../components/icons";
import { EASE } from "../lib/motion";
import { formatDuration } from "../lib/format";
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
  const Form = getConfigForm(node.data.nodeType);
  const Icon = spec.icon;

  const tab = useEditor((s) => s.inspectorTab);
  const setTab = useEditor((s) => s.setInspectorTab);
  const hasRun = useEditor((s) => s.activeRun !== null);
  const execution = useEditor(
    (s) => s.activeRun?.nodeExecutions.find((e) => e.nodeId === node.id) ?? null,
  );

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
          <Tab label="Last run" active={tab === "lastrun"} onClick={() => setTab("lastrun")} dot={hasRun} />
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "config" ? (
          Form ? (
            <Form nodeId={node.id} config={node.data.config} onChange={onConfig} />
          ) : (
            <p className="text-sm text-muted">This node has no configurable settings.</p>
          )
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
