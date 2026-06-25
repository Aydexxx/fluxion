import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { WorkflowNode } from "./WorkflowNode";
import { CanvasControls } from "./CanvasControls";
import { PresenceLayer } from "./PresenceLayer";
import { sendCursor } from "./presence";
import { categoryAccent } from "./nodeCatalog";
import type { FluxNode } from "./graph";
import { DRAG_MIME } from "./dragMime";
import { navigate } from "../lib/router";

const SNAP_GRID: [number, number] = [24, 24];

const nodeTypes = { flux: WorkflowNode };

const defaultEdgeOptions = {
  type: "default" as const,
  style: { strokeWidth: 1.5 },
};

export function WorkflowCanvas() {
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const status = useEditor((s) => s.status);
  const workflowId = useEditor((s) => s.id);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const readOnly = useEditor((s) => s.previewVersion !== null);
  const onNodesChange = useEditor((s) => s.onNodesChange);
  const onEdgesChange = useEditor((s) => s.onEdgesChange);
  const onConnect = useEditor((s) => s.onConnect);
  const addNodeAt = useEditor((s) => s.addNodeAt);
  const selectNode = useEditor((s) => s.selectNode);
  const beginInteraction = useEditor((s) => s.beginInteraction);

  // Fit the view once a workflow's graph has loaded.
  useEffect(() => {
    if (status !== "ready") return;
    const t = setTimeout(() => {
      reactFlow.fitView({ padding: 0.32, duration: reduceMotion ? 0 : 600, maxZoom: 1.1 });
    }, 60);
    return () => clearTimeout(t);
  }, [status, workflowId, reactFlow, reduceMotion]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (readOnly) return; // can't drop nodes while previewing a past version
      const type = event.dataTransfer.getData(DRAG_MIME);
      if (!type) return;
      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Center the node on the cursor (node is 228px wide, ~74px tall).
      addNodeAt(type, { x: position.x - 114, y: position.y - 37 });
    },
    [reactFlow, addNodeAt, readOnly],
  );

  // Broadcast our cursor in flow-space so it tracks canvas content for peers
  // regardless of their own pan/zoom. Throttled inside the presence client.
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const p = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      sendCursor(p.x, p.y);
    },
    [reactFlow],
  );

  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);
  // Snapshot the graph once when a drag (single node or selection) begins, so a
  // whole move collapses to a single undo step.
  const onDragStart = useCallback(() => beginInteraction(), [beginInteraction]);

  return (
    <div ref={wrapperRef} className="relative h-full w-full" onDrop={onDrop} onDragOver={onDragOver} onPointerMove={onPointerMove}>
      {/* Ambient atmosphere behind the dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bloom"
        style={reduceMotion ? undefined : { animation: "flux-pan 32s linear infinite alternate" }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 grain opacity-60" />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onNodeDragStart={onDragStart}
        onSelectionDragStart={onDragStart}
        // Deletion is owned by the editor shortcut layer for clean, grouped undo history.
        deleteKeyCode={null}
        // Shift-click adds to the selection; Shift-drag on the pane draws a marquee.
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        // Read-only while previewing a past version: pan/zoom only, no editing.
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
        proOptions={{ hideAttribution: false }}
        minZoom={0.3}
        maxZoom={1.75}
        fitView
        fitViewOptions={{ padding: 0.32, maxZoom: 1.1 }}
        className="!bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="color-mix(in oklab, white 9%, transparent)"
        />
        <CanvasControls />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          maskColor="color-mix(in oklab, #050507 78%, transparent)"
          nodeColor={(n) => categoryAccent((n.data as FluxNode["data"])?.nodeType ?? "action.http")}
          nodeStrokeWidth={0}
          style={{ width: 168, height: 112 }}
        />
      </ReactFlow>

      {/* Remote collaborators: live cursors, selection highlights, edit badges. */}
      <PresenceLayer />

      {status === "ready" && nodes.length === 0 && !readOnly ? <EmptyCanvasHint /> : null}
    </div>
  );
}

function EmptyCanvasHint() {
  const setCommandPaletteOpen = useEditor((s) => s.setCommandPaletteOpen);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="select-none text-center">
        <p className="font-display text-[15px] font-medium text-muted">Your canvas is empty</p>
        <p className="mt-1 text-[13px] text-faint">
          Drag a <span className="text-ink">trigger</span> from the node library, or
        </p>
        <div className="pointer-events-auto mt-4 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface/70 px-3 py-1.5 text-[12.5px] font-medium text-ink backdrop-blur transition-colors hover:bg-white/5"
          >
            Open palette
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-faint">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => navigate("/templates")}
            className="rounded-lg border border-white/10 bg-surface/70 px-3 py-1.5 text-[12.5px] font-medium text-ink backdrop-blur transition-colors hover:bg-white/5"
          >
            Browse templates
          </button>
        </div>
      </div>
    </div>
  );
}
