import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { FluxNode } from "./graph";
import { categoryAccent, getNodeSpec } from "./nodeCatalog";
import { useEditor } from "./editorStore";
import { statusVisual, type NodeRunStatus } from "./runStatus";
import { AlertIcon, CheckIcon, SpinnerIcon } from "../components/icons";

function WorkflowNodeComponent({ id, data, selected }: NodeProps<FluxNode>) {
  const spec = getNodeSpec(data.nodeType);
  const accent = categoryAccent(data.nodeType);
  const Icon = spec.icon;

  // Driven live by the worker's per-node events (idle until this node starts).
  const runStatus = useEditor((s) => s.nodeRunStatus[id] ?? "idle");
  const active = runStatus !== "idle";
  const statusColor = statusVisual(runStatus).color;

  // A status ring (when there's a run result) takes visual priority over the selection ring.
  const ringColor = active ? statusColor : selected ? accent : null;

  return (
    <div
      className="group relative w-[228px] rounded-[15px] transition-all duration-300"
      style={{
        background: "linear-gradient(165deg, var(--color-surface-2), var(--color-surface))",
        border: `1px solid ${ringColor ? "color-mix(in oklab, " + ringColor + " 55%, transparent)" : "color-mix(in oklab, white 9%, transparent)"}`,
        boxShadow: ringColor
          ? `0 0 0 1px color-mix(in oklab, ${ringColor} 42%, transparent), 0 18px 50px -18px color-mix(in oklab, ${ringColor} 52%, transparent), inset 0 1px 0 color-mix(in oklab, white 6%, transparent)`
          : "0 14px 40px -22px rgba(0,0,0,0.9), inset 0 1px 0 color-mix(in oklab, white 5%, transparent)",
      }}
    >
      {/* thin category accent line along the top edge */}
      <div
        className="absolute inset-x-3 top-0 h-px rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: selected || active ? 0.9 : 0.5 }}
      />

      <StatusPip status={runStatus} color={statusColor} />

      {spec.hasInput ? <Handle type="target" position={Position.Left} /> : null}
      {spec.hasOutput ? <Handle type="source" position={Position.Right} /> : null}

      <div className="flex items-center gap-3 p-3.5">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-[11px] text-[18px] transition-transform duration-200 group-hover:scale-[1.04]"
          style={{
            color: accent,
            background: `color-mix(in oklab, ${accent} 15%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 28%, transparent)`,
          }}
        >
          <Icon />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-[10px] uppercase tracking-[0.13em]"
            style={{ color: `color-mix(in oklab, ${accent} 78%, white 4%)` }}
          >
            {spec.label}
          </div>
          <div className="truncate text-[14px] font-medium leading-tight text-ink" title={data.title}>
            {data.title || spec.defaultTitle}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small animated status badge in the node's top-right corner. */
function StatusPip({ status, color }: { status: NodeRunStatus; color: string }) {
  const reduce = useReducedMotion();
  if (status === "idle") return null;

  return (
    <AnimatePresence>
      <motion.div
        key={status}
        initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
        animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 26 }}
        className="absolute -right-1.5 -top-1.5 z-10 flex size-[18px] items-center justify-center rounded-full text-[10px] text-white"
        style={{ background: color, boxShadow: `0 0 0 3px var(--color-surface), 0 0 14px -2px ${color}` }}
      >
        {status === "running" ? (
          <SpinnerIcon className={reduce ? undefined : "animate-spin"} />
        ) : status === "success" ? (
          <CheckIcon />
        ) : (
          <AlertIcon />
        )}
        {status === "running" && !reduce ? (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ border: `1.5px solid ${color}` }}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
