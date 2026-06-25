import { Panel, useReactFlow, useStore } from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import {
  FrameIcon,
  KeyboardIcon,
  MagnetIcon,
  MinusIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from "../components/icons";

/**
 * Bottom-right control cluster: undo/redo, zoom in/out with a live percentage,
 * fit-view, a snap-to-grid toggle and the shortcuts help. Styled to the design
 * system; replaces React Flow's default <Controls>.
 */
export function CanvasControls() {
  const reduce = useReducedMotion();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const snap = useEditor((s) => s.snapToGrid);
  const setSnap = useEditor((s) => s.setSnapToGrid);
  const setShortcutsOpen = useEditor((s) => s.setShortcutsOpen);

  const fit = () => fitView({ padding: 0.3, duration: reduce ? 0 : 500, maxZoom: 1.1 });

  return (
    <Panel position="bottom-right" className="!m-3">
      <div className="flex items-center gap-0.5 rounded-xl border border-white/8 bg-surface/80 p-1 backdrop-blur-xl"
        style={{ boxShadow: "0 12px 40px -12px rgba(0,0,0,0.8)" }}
      >
        <Btn label="Undo" onClick={undo} disabled={!canUndo}>
          <UndoIcon />
        </Btn>
        <Btn label="Redo" onClick={redo} disabled={!canRedo}>
          <RedoIcon />
        </Btn>

        <Divider />

        <Btn label="Zoom out" onClick={() => zoomOut({ duration: reduce ? 0 : 200 })}>
          <MinusIcon />
        </Btn>
        <span className="w-[42px] select-none text-center font-mono text-[11px] tabular-nums text-muted">
          {Math.round((zoom ?? 1) * 100)}%
        </span>
        <Btn label="Zoom in" onClick={() => zoomIn({ duration: reduce ? 0 : 200 })}>
          <PlusIcon />
        </Btn>
        <Btn label="Fit view" onClick={fit}>
          <FrameIcon />
        </Btn>

        <Divider />

        <Btn label={snap ? "Snapping on" : "Snapping off"} onClick={() => setSnap(!snap)} active={snap}>
          <MagnetIcon />
        </Btn>
        <Btn label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
          <KeyboardIcon />
        </Btn>
      </div>
    </Panel>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-white/8" />;
}

function Btn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-7 items-center justify-center rounded-lg text-[15px] transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${
        active ? "" : "text-muted hover:bg-white/[0.07] hover:text-ink"
      }`}
      style={active ? { color: "var(--color-accent-bright)", background: "color-mix(in oklab, var(--color-accent) 16%, transparent)" } : undefined}
    >
      {children}
    </button>
  );
}
