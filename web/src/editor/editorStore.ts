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
import type { Credential, RunSummary, WorkflowRun } from "../lib/types";
import type { RunLiveEvent } from "../lib/realtimeEvents";
import { toast } from "../store/toasts";
import { createNode, definitionToFlow, flowToDefinition, newEdgeId, type FluxEdge, type FluxNode } from "./graph";
import { toNodeRunStatus, type NodeRunStatus } from "./runStatus";
import { subscribeToRun, unsubscribeFromRun } from "./liveRun";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type InspectorTab = "config" | "lastrun";

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
  selectedNodeId: string | null;

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
    // If the selected node was removed, clear the selection.
    const removed = changes.some((c) => c.type === "remove" && c.id === get().selectedNodeId);
    if (removed) patch.selectedNodeId = null;
    if (isDirtying(changes)) patch.dirty = true;
    set(patch);
  },

  onEdgesChange: (changes) => {
    const edges = applyEdgeChanges(changes, get().edges);
    set({ edges, dirty: isDirtying(changes) ? true : get().dirty });
  },

  onConnect: (connection) => {
    if (connection.source === connection.target) return; // no self-loops
    const edges = addEdge({ ...connection, id: newEdgeId() }, get().edges);
    set({ edges, dirty: true });
  },

  addNodeAt: (type, position) => {
    const node = createNode(type, position);
    set({ nodes: [...get().nodes, node], selectedNodeId: node.id, dirty: true });
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNodeConfig: (id, config) =>
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n)),
      dirty: true,
    }),

  updateNodeTitle: (id, title) =>
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n)),
      dirty: true,
    }),

  deleteNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      dirty: true,
    }),

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
