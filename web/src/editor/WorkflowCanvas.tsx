import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { WorkflowNode } from "./WorkflowNode";
import { categoryAccent } from "./nodeCatalog";
import type { FluxNode } from "./graph";
import { DRAG_MIME } from "./dragMime";

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
  const onNodesChange = useEditor((s) => s.onNodesChange);
  const onEdgesChange = useEditor((s) => s.onEdgesChange);
  const onConnect = useEditor((s) => s.onConnect);
  const addNodeAt = useEditor((s) => s.addNodeAt);
  const selectNode = useEditor((s) => s.selectNode);

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
      const type = event.dataTransfer.getData(DRAG_MIME);
      if (!type) return;
      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Center the node on the cursor (node is 228px wide, ~74px tall).
      addNodeAt(type, { x: position.x - 114, y: position.y - 37 });
    },
    [reactFlow, addNodeAt],
  );

  const onNodeClick = useCallback<NodeMouseHandler<FluxNode>>((_, node) => selectNode(node.id), [selectNode]);
  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

  return (
    <div ref={wrapperRef} className="relative h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
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
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        deleteKeyCode={["Backspace", "Delete"]}
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
        <Controls
          showInteractive={false}
          position="bottom-right"
          className="!shadow-none"
        />
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

      {status === "ready" && nodes.length === 0 ? <EmptyCanvasHint /> : null}
    </div>
  );
}

function EmptyCanvasHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="select-none text-center">
        <p className="font-display text-[15px] font-medium text-muted">Your canvas is empty</p>
        <p className="mt-1 text-[13px] text-faint">
          Drag a <span className="text-ink">trigger</span> from the left to begin the flow.
        </p>
      </div>
    </div>
  );
}
