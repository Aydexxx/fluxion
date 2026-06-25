import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { workflowApi, runApi, credentialApi, errorMessage } from "../lib/api";
import type { Credential, NodeTestResult, RunSummary, WorkflowRun } from "../lib/types";
import type { RunLiveEvent } from "../lib/realtimeEvents";
import { toast } from "../store/toasts";
import {
  cloneSubgraph,
  createNode,
  definitionToFlow,
  flowToDefinition,
  newEdgeId,
  type FluxEdge,
  type FluxNode,
} from "./graph";
import { buildSampleScope, lastRunSources } from "./sampleData";
import { toNodeRunStatus, type NodeRunStatus } from "./runStatus";
import { subscribeToRun, unsubscribeFromRun } from "./liveRun";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type InspectorTab = "config" | "test" | "lastrun";

interface GraphSnapshot {
  nodes: FluxNode[];
  edges: FluxEdge[];
}

/** How many undo steps to retain, and the window within which same-key edits merge. */
const HISTORY_LIMIT = 100;
const COALESCE_MS = 600;

/** Deep, independent copy of the graph for the history/clipboard stacks. */
function cloneGraph(nodes: FluxNode[], edges: FluxEdge[]): GraphSnapshot {
  return { nodes: structuredClone(nodes), edges: structuredClone(edges) };
}

interface EditorState {
  status: LoadStatus;
  error: string | null;

  id: string | null;
  workspaceId: string | null;
  name: string;
  isActive: boolean;
  webhookToken: string | null;

  /** Workspace credentials (metadata only) available to node credential pickers. */
  credentials: Credential[];
  credentialsManagerOpen: boolean;

  nodes: FluxNode[];
  edges: FluxEdge[];
  /** The node surfaced in the inspector — set only when exactly one node is selected. */
  selectedNodeId: string | null;

  // ── Edit history (bounded undo/redo over the {nodes, edges} graph) ─────────
  past: GraphSnapshot[];
  future: GraphSnapshot[];
  /** Coalescing key + timestamp so rapid same-target edits collapse to one step. */
  historyKey: string | null;
  historyAt: number;

  /** In-app clipboard for copy/paste of a node sub-graph. */
  clipboard: GraphSnapshot | null;
  /** How many times the current clipboard has been pasted (drives the paste offset). */
  clipboardPastes: number;

  /** Snap node positions to the grid while dragging, for clean alignment. */
  snapToGrid: boolean;
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;

  dirty: boolean;
  saving: boolean;
  warnings: string[];
  savedAt: number | null;

  // ── Run / execution results ──────────────────────────────────────────────
  running: boolean;
  /** The run whose results are surfaced on the canvas + inspector (live or replayed). */
  activeRun: WorkflowRun | null;
  /** True when `activeRun` is a historical run being replayed read-only. */
  replay: boolean;
  /** Per-node canvas status derived from the active run. Absent = idle. */
  nodeRunStatus: Record<string, NodeRunStatus>;
  resultsOpen: boolean;
  historyOpen: boolean;
  runs: RunSummary[];
  runsLoading: boolean;
  inspectorTab: InspectorTab;

  /** Last single-node test result per node id, and the node currently testing. */
  nodeTests: Record<string, NodeTestResult>;
  testingNodeId: string | null;

  load: (id: string) => Promise<void>;
  reset: () => void;
  refreshCredentials: () => Promise<void>;
  setCredentialsManagerOpen: (open: boolean) => void;

  onNodesChange: (changes: NodeChange<FluxNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FluxEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addNodeAt: (type: string, position: { x: number; y: number }) => void;
  selectNode: (id: string | null) => void;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  updateNodeTitle: (id: string, title: string) => void;
  deleteNode: (id: string) => void;

  // ── Pinned sample data + single-node testing ───────────────────────────────
  /** Pin (or clear, with `undefined`) mock output on a node for design-time previews and tests. */
  setNodePinned: (id: string, data: unknown | undefined) => void;
  /** Execute one node in isolation against current sample data; result lands in `nodeTests`. */
  testNode: (id: string) => Promise<{ ok: boolean; message?: string }>;
  clearNodeTest: (id: string) => void;

  // ── History / selection / clipboard ───────────────────────────────────────
  /** Snapshot the current graph onto the undo stack. `coalesceKey` collapses bursts. */
  pushHistory: (coalesceKey?: string) => void;
  /** Snapshot before a continuous interaction (e.g. a drag) begins. */
  beginInteraction: () => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  deleteSelection: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  duplicateSelection: () => void;
  setSnapToGrid: (snap: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;

  setName: (name: string) => void;
  setActive: (isActive: boolean) => void;

  save: () => Promise<{ ok: boolean; message?: string }>;

  run: () => Promise<{ ok: boolean; message?: string }>;
  applyLiveEvent: (event: RunLiveEvent) => void;
  loadRunResult: (runId: string) => Promise<{ ok: boolean; message?: string }>;
  refreshRuns: () => Promise<void>;
  clearRun: () => void;
  setHistoryOpen: (open: boolean) => void;
  setResultsOpen: (open: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
}

/** Build the per-node canvas status map from a run's executions. */
function deriveNodeRunStatus(run: WorkflowRun): Record<string, NodeRunStatus> {
  const map: Record<string, NodeRunStatus> = {};
  for (const exec of run.nodeExecutions) map[exec.nodeId] = toNodeRunStatus(exec.status);
  return map;
}

/** Fresh run-state slice, used on load/reset. */
const EMPTY_RUN_STATE = {
  running: false,
  activeRun: null,
  replay: false,
  nodeRunStatus: {} as Record<string, NodeRunStatus>,
  resultsOpen: false,
  historyOpen: false,
  runs: [] as RunSummary[],
  runsLoading: false,
  inspectorTab: "config" as InspectorTab,
  // Single-node test results, keyed by node id, plus the node currently testing.
  nodeTests: {} as Record<string, NodeTestResult>,
  testingNodeId: null as string | null,
};

const POSITION_OR_STRUCTURE = new Set(["position", "add", "remove", "replace"]);

/** A change set is "meaningful" (marks the graph dirty) unless it's only selection/measurement noise. */
function isDirtying(changes: Array<{ type: string }>): boolean {
  return changes.some((c) => POSITION_OR_STRUCTURE.has(c.type));
}

export const useEditor = create<EditorState>((set, get) => ({
  status: "idle",
  error: null,
  id: null,
  workspaceId: null,
  name: "",
  isActive: true,
  webhookToken: null,
  credentials: [],
  credentialsManagerOpen: false,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  past: [],
  future: [],
  historyKey: null,
  historyAt: 0,
  clipboard: null,
  clipboardPastes: 0,
  snapToGrid: true,
  commandPaletteOpen: false,
  shortcutsOpen: false,
  dirty: false,
  saving: false,
  warnings: [],
  savedAt: null,
  ...EMPTY_RUN_STATE,

  load: async (id) => {
    unsubscribeFromRun();
    set({ status: "loading", error: null, id });
    try {
      const wf = await workflowApi.get(id);
      const { nodes, edges } = definitionToFlow(wf.definition);
      set({
        status: "ready",
        id: wf.id,
        workspaceId: wf.workspaceId,
        name: wf.name,
        isActive: wf.isActive,
        webhookToken: wf.webhookToken,
        nodes,
        edges,
        selectedNodeId: null,
        past: [],
        future: [],
        historyKey: null,
        historyAt: 0,
        clipboard: null,
        clipboardPastes: 0,
        commandPaletteOpen: false,
        shortcutsOpen: false,
        dirty: false,
        warnings: [],
        savedAt: null,
        credentials: [],
        credentialsManagerOpen: false,
        ...EMPTY_RUN_STATE,
      });
      void get().refreshCredentials();
    } catch (err) {
      set({ status: "error", error: errorMessage(err, "Could not load this workflow") });
    }
  },

  refreshCredentials: async () => {
    const workspaceId = get().workspaceId;
    if (!workspaceId) return;
    try {
      set({ credentials: await credentialApi.list(workspaceId) });
    } catch {
      // Non-fatal: pickers just show no options until the next refresh.
    }
  },

  setCredentialsManagerOpen: (open) => set({ credentialsManagerOpen: open }),

  reset: () => {
    unsubscribeFromRun();
    set({
      status: "idle",
      error: null,
      id: null,
      workspaceId: null,
      name: "",
      isActive: true,
      webhookToken: null,
      credentials: [],
      credentialsManagerOpen: false,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      past: [],
      future: [],
      historyKey: null,
      historyAt: 0,
      clipboard: null,
      clipboardPastes: 0,
      commandPaletteOpen: false,
      shortcutsOpen: false,
      dirty: false,
      saving: false,
      warnings: [],
      savedAt: null,
      ...EMPTY_RUN_STATE,
    });
  },

  onNodesChange: (changes) => {
    const nodes = applyNodeChanges(changes, get().nodes);
    const patch: Partial<EditorState> = { nodes };
    if (isDirtying(changes)) patch.dirty = true;
    // The inspector follows selection: open only when a single node is selected.
    if (changes.some((c) => c.type === "select")) {
      const selected = nodes.filter((n) => n.selected);
      patch.selectedNodeId = selected.length === 1 ? selected[0].id : null;
    }
    // If the inspector's node was removed, close it.
    if (changes.some((c) => c.type === "remove" && c.id === get().selectedNodeId)) {
      patch.selectedNodeId = null;
    }
    set(patch);
  },

  onEdgesChange: (changes) => {
    const edges = applyEdgeChanges(changes, get().edges);
    set({ edges, dirty: isDirtying(changes) ? true : get().dirty });
  },

  onConnect: (connection) => {
    if (connection.source === connection.target) return; // no self-loops
    get().pushHistory();
    const edges = addEdge({ ...connection, id: newEdgeId() }, get().edges);
    set({ edges, dirty: true });
  },

  addNodeAt: (type, position) => {
    get().pushHistory();
    const node = createNode(type, position);
    // Drop it in as the sole selection so it's immediately inspectable.
    const nodes = get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    set({ nodes: [...nodes, { ...node, selected: true }], selectedNodeId: node.id, dirty: true });
  },

  selectNode: (id) =>
    set({
      selectedNodeId: id,
      nodes: get().nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
    }),

  updateNodeConfig: (id, config) => {
    get().pushHistory(`config:${id}`);
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n)),
      dirty: true,
    });
  },

  updateNodeTitle: (id, title) => {
    get().pushHistory(`title:${id}`);
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n)),
      dirty: true,
    });
  },

  deleteNode: (id) => {
    get().pushHistory();
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      dirty: true,
    });
  },

  // ── Pinned sample data + single-node testing ───────────────────────────────
  setNodePinned: (id, data) => {
    get().pushHistory(`pin:${id}`);
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n;
        const nextData = { ...n.data };
        if (data === undefined) delete nextData.pinned;
        else nextData.pinned = data;
        return { ...n, data: nextData };
      }),
      dirty: true,
    });
  },

  testNode: async (id) => {
    const { id: workflowId, dirty, nodes, edges, activeRun } = get();
    if (!workflowId) return { ok: false, message: "Nothing to test" };

    // The endpoint reads the *saved* definition for topology + ancestor pins, so
    // flush pending edits first (mirrors run()).
    if (dirty) {
      const saved = await get().save();
      if (!saved.ok) return { ok: false, message: saved.message ?? "Could not save before testing" };
    }

    const node = nodes.find((n) => n.id === id);
    if (!node) return { ok: false, message: "Node not found" };

    // Sample context: the trigger payload and last-run outputs feed the node;
    // pinned data on ancestors is applied server-side (takes precedence).
    const { scope } = buildSampleScope(nodes, edges, activeRun, id);
    set({ testingNodeId: id });
    try {
      const result = await workflowApi.testNode(workflowId, id, {
        config: node.data.config,
        trigger: scope.trigger,
        sources: lastRunSources(activeRun),
      });
      set((s) => ({ nodeTests: { ...s.nodeTests, [id]: result }, testingNodeId: null }));
      if (result.status === "failed") toast.error("Node test failed");
      else toast.success("Node test ran");
      return { ok: true };
    } catch (err) {
      set({ testingNodeId: null });
      return { ok: false, message: errorMessage(err, "Could not test this node") };
    }
  },

  clearNodeTest: (id) =>
    set((s) => {
      const nodeTests = { ...s.nodeTests };
      delete nodeTests[id];
      return { nodeTests };
    }),

  // ── History / selection / clipboard ───────────────────────────────────────
  pushHistory: (coalesceKey) => {
    const now = Date.now();
    const { past, historyKey, historyAt, nodes, edges } = get();
    // Collapse rapid edits to the same target (e.g. typing in a config field).
    if (coalesceKey && coalesceKey === historyKey && now - historyAt < COALESCE_MS) {
      set({ historyAt: now });
      return;
    }
    const snapshot = cloneGraph(nodes, edges);
    const next = past.length >= HISTORY_LIMIT ? [...past.slice(1), snapshot] : [...past, snapshot];
    set({ past: next, future: [], historyKey: coalesceKey ?? null, historyAt: now });
  },

  beginInteraction: () => get().pushHistory(),

  undo: () => {
    const { past, future, nodes, edges, selectedNodeId } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const present = cloneGraph(nodes, edges);
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: past.slice(0, -1),
      future: [present, ...future],
      selectedNodeId: previous.nodes.some((n) => n.id === selectedNodeId) ? selectedNodeId : null,
      historyKey: null,
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, nodes, edges, selectedNodeId } = get();
    if (future.length === 0) return;
    const nextState = future[0];
    const present = cloneGraph(nodes, edges);
    set({
      nodes: nextState.nodes,
      edges: nextState.edges,
      past: [...past, present],
      future: future.slice(1),
      selectedNodeId: nextState.nodes.some((n) => n.id === selectedNodeId) ? selectedNodeId : null,
      historyKey: null,
      dirty: true,
    });
  },

  selectAll: () =>
    set({
      nodes: get().nodes.map((n) => (n.selected ? n : { ...n, selected: true })),
      selectedNodeId: get().nodes.length === 1 ? get().nodes[0].id : null,
    }),

  deleteSelection: () => {
    const { nodes, edges, selectedNodeId } = get();
    const nodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (selectedNodeId) nodeIds.add(selectedNodeId);
    const edgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
    if (nodeIds.size === 0 && edgeIds.size === 0) return;
    get().pushHistory();
    set({
      nodes: nodes.filter((n) => !nodeIds.has(n.id)),
      edges: edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)),
      selectedNodeId: null,
      dirty: true,
    });
  },

  copySelection: () => {
    const { nodes, edges } = get();
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    const ids = new Set(selected.map((n) => n.id));
    const internal = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    set({ clipboard: cloneGraph(selected, internal), clipboardPastes: 0 });
  },

  pasteClipboard: () => {
    const clip = get().clipboard;
    if (!clip || clip.nodes.length === 0) return;
    const tick = get().clipboardPastes + 1;
    const delta = 24 * tick;
    const { nodes: pasted, edges: pastedEdges } = cloneSubgraph(clip.nodes, clip.edges, { x: delta, y: delta });
    get().pushHistory();
    const cleared = get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    set({
      nodes: [...cleared, ...pasted],
      edges: [...get().edges, ...pastedEdges],
      clipboardPastes: tick,
      selectedNodeId: pasted.length === 1 ? pasted[0].id : null,
      dirty: true,
    });
  },

  duplicateSelection: () => {
    const { nodes, edges } = get();
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    const ids = new Set(selected.map((n) => n.id));
    const internal = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const { nodes: dup, edges: dupEdges } = cloneSubgraph(selected, internal, { x: 24, y: 24 });
    get().pushHistory();
    const cleared = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    set({
      nodes: [...cleared, ...dup],
      edges: [...edges, ...dupEdges],
      selectedNodeId: dup.length === 1 ? dup[0].id : null,
      dirty: true,
    });
  },

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  setName: (name) => set({ name, dirty: true }),
  setActive: (isActive) => set({ isActive, dirty: true }),

  save: async () => {
    const { id, name, isActive, nodes, edges } = get();
    if (!id) return { ok: false, message: "Nothing to save" };
    set({ saving: true });
    try {
      const definition = flowToDefinition(nodes, edges);
      const res = await workflowApi.update(id, { name, isActive, definition });
      set({ saving: false, dirty: false, warnings: res.warnings ?? [], savedAt: Date.now() });
      return { ok: true };
    } catch (err) {
      set({ saving: false });
      return { ok: false, message: errorMessage(err, "Could not save the workflow") };
    }
  },

  run: async () => {
    const { id, dirty, running } = get();
    if (!id) return { ok: false, message: "Nothing to run" };
    if (running) return { ok: false, message: "Already running" };

    // The engine runs the *saved* definition, so flush pending edits first.
    if (dirty) {
      const saved = await get().save();
      if (!saved.ok) return { ok: false, message: saved.message ?? "Could not save before running" };
    }

    set({ running: true, activeRun: null, replay: false, nodeRunStatus: {}, resultsOpen: true });
    try {
      // Enqueues and returns immediately with a queued run; the worker executes
      // it and pushes live status over the socket, applied via applyLiveEvent.
      const queued = await runApi.start(id);
      set({ activeRun: queued, replay: false, nodeRunStatus: {} });
      subscribeToRun(queued.id, (event) => get().applyLiveEvent(event));
      return { ok: true };
    } catch (err) {
      set({ running: false });
      return { ok: false, message: errorMessage(err, "Run failed to start") };
    }
  },

  applyLiveEvent: (event) => {
    // Ignore stray events for a run we're no longer watching.
    if (get().activeRun?.id !== event.runId) return;

    switch (event.type) {
      case "run:started":
        set({ running: true, nodeRunStatus: {} });
        break;
      case "node:started":
        set((s) => ({ nodeRunStatus: { ...s.nodeRunStatus, [event.nodeId]: "running" } }));
        break;
      case "node:finished":
        set((s) => ({
          nodeRunStatus: { ...s.nodeRunStatus, [event.nodeId]: event.status === "failed" ? "failed" : "success" },
        }));
        break;
      case "run:finished": {
        set({ running: false });
        // Pull the full run for final per-node outputs (the live events are status-only).
        void runApi
          .get(event.runId)
          .then((full) => {
            if (get().activeRun?.id !== full.id) return;
            set({ activeRun: full, nodeRunStatus: deriveNodeRunStatus(full), inspectorTab: "lastrun" });
            if (full.status === "failed") toast.error("Run failed");
            else toast.success("Run completed");
            void get().refreshRuns();
          })
          .catch(() => {});
        break;
      }
    }
  },

  loadRunResult: async (runId) => {
    unsubscribeFromRun();
    try {
      const result = await runApi.get(runId);
      set({
        activeRun: result,
        replay: true,
        nodeRunStatus: deriveNodeRunStatus(result),
        resultsOpen: true,
        historyOpen: false,
        inspectorTab: "lastrun",
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: errorMessage(err, "Could not load this run") };
    }
  },

  refreshRuns: async () => {
    const { id } = get();
    if (!id) return;
    set({ runsLoading: true });
    try {
      const runs = await runApi.history(id);
      set({ runs, runsLoading: false });
    } catch {
      set({ runsLoading: false });
    }
  },

  clearRun: () => {
    unsubscribeFromRun();
    set({ activeRun: null, replay: false, nodeRunStatus: {}, resultsOpen: false, running: false, inspectorTab: "config" });
  },

  setHistoryOpen: (open) => {
    set({ historyOpen: open });
    if (open) void get().refreshRuns();
  },
  setResultsOpen: (open) => set({ resultsOpen: open }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
}));
