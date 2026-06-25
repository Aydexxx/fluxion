import { useEffect, useMemo, useRef } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { CURSOR_STALE_MS, getCursorTargets, usePresence } from "./presence";

/** Node footprint fallbacks (matches WorkflowNode's 228px width) until measured. */
const NODE_WIDTH = 228;
const NODE_HEIGHT = 76;

/**
 * Renders remote collaborators on the canvas: smoothly-interpolated live
 * cursors, subtle selection highlights, and "X is editing" badges. Mounted
 * inside the canvas wrapper so its absolute overlay aligns 1:1 with the React
 * Flow pane (flow→pixel uses the same viewport transform).
 */
export function PresenceLayer() {
  const hasPeers = usePresence((s) => Object.keys(s.participants).length > 0);
  if (!hasPeers) return null;
  return (
    <>
      <LiveCursors />
      <RemoteOverlays />
    </>
  );
}

/**
 * Live cursors, animated entirely off the React render path: a single rAF loop
 * lerps each cursor toward its latest flow-space target (re-projected each frame
 * so the cursor stays glued to canvas content while the local user pans/zooms).
 * Reduced motion snaps instead of interpolating.
 */
function LiveCursors() {
  const reactFlow = useReactFlow();
  const reduce = useReducedMotion();
  const participants = usePresence((s) => s.participants);
  const elRefs = useRef(new Map<string, HTMLDivElement>());
  const rendered = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { x: vx, y: vy, zoom } = reactFlow.getViewport();
      const targets = getCursorTargets();
      const now = Date.now();
      for (const [socketId, el] of elRefs.current) {
        const target = targets.get(socketId);
        if (!target || now - target.at > CURSOR_STALE_MS) {
          el.style.opacity = "0";
          rendered.current.delete(socketId); // so it re-enters cleanly, no fly-in from a stale spot
          continue;
        }
        const sx = target.x * zoom + vx;
        const sy = target.y * zoom + vy;
        const cur = rendered.current.get(socketId);
        const next = reduce || !cur ? { x: sx, y: sy } : { x: cur.x + (sx - cur.x) * 0.25, y: cur.y + (sy - cur.y) * 0.25 };
        rendered.current.set(socketId, next);
        el.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
        el.style.opacity = "1";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reactFlow, reduce]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[16] overflow-hidden">
      {Object.values(participants).map((p) => (
        <div
          key={p.socketId}
          ref={(el) => {
            if (el) elRefs.current.set(p.socketId, el);
            else elRefs.current.delete(p.socketId);
          }}
          className="absolute left-0 top-0 opacity-0 will-change-transform"
        >
          <CursorGlyph color={p.color} name={p.name} />
        </div>
      ))}
    </div>
  );
}

function CursorGlyph({ color, name }: { color: string; name: string }) {
  return (
    <div className="relative">
      <svg width="20" height="22" viewBox="0 0 20 22" fill="none" className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
        <path
          d="M3 2.5 16.5 9.2c.9.45.7 1.78-.27 1.95l-5.6.97-2.8 5.05c-.48.86-1.78.6-1.9-.38L3 2.5Z"
          fill={color}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="absolute left-4 top-3.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white shadow-md"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  );
}

/**
 * Selection highlights + edit-lock badges. These are low-frequency relative to
 * cursor motion, so they ride React's render path, recomputing on viewport,
 * graph, or presence changes via the standard transform.
 */
function RemoteOverlays() {
  const { x: vx, y: vy, zoom } = useViewport();
  const nodes = useEditor((s) => s.nodes);
  const participants = usePresence((s) => s.participants);
  const selections = usePresence((s) => s.selections);
  const editing = usePresence((s) => s.editing);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  type Rect = { left: number; top: number; width: number; height: number };
  const rectFor = (nodeId: string): Rect | null => {
    const node = byId.get(nodeId);
    if (!node) return null;
    const w = node.measured?.width ?? NODE_WIDTH;
    const h = node.measured?.height ?? NODE_HEIGHT;
    return { left: node.position.x * zoom + vx, top: node.position.y * zoom + vy, width: w * zoom, height: h * zoom };
  };

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
      {Object.values(participants).flatMap((p) => {
        const els: React.ReactNode[] = [];

        // Subtle selection highlight in the peer's color.
        for (const nodeId of selections[p.socketId] ?? []) {
          const r = rectFor(nodeId);
          if (!r) continue;
          els.push(
            <div
              key={`${p.socketId}:sel:${nodeId}`}
              className="absolute rounded-[15px]"
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                border: `1.5px solid ${p.color}`,
                boxShadow: `0 0 0 3px color-mix(in oklab, ${p.color} 22%, transparent)`,
                opacity: 0.9,
              }}
            />,
          );
        }

        // Non-blocking "editing" badge anchored to the node being edited.
        const editId = editing[p.socketId];
        if (editId) {
          const r = rectFor(editId);
          if (r) {
            els.push(
              <div
                key={`${p.socketId}:edit:${editId}`}
                className="absolute flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium text-white shadow-md"
                style={{ left: r.left, top: r.top - 22, background: p.color }}
              >
                <PencilGlyph /> {p.name} editing
              </div>,
            );
          }
        }

        return els;
      })}
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}
