import { create } from "zustand";
import { getSocket } from "../lib/socket";
import {
  GRAPH_APPLY,
  PRESENCE_CURSOR,
  PRESENCE_EDITING,
  PRESENCE_JOIN,
  PRESENCE_JOINED,
  PRESENCE_LEAVE,
  PRESENCE_LEFT,
  PRESENCE_SELECTION,
  PRESENCE_SYNC,
  type GraphApplyPayload,
  type GraphOp,
  type Participant,
  type PresenceCursorPayload,
  type PresenceEditingPayload,
  type PresenceJoinedPayload,
  type PresenceLeftPayload,
  type PresenceSelectionPayload,
  type PresenceSyncPayload,
} from "../lib/presenceEvents";

/**
 * Client-side hub for editor presence. Owns one workflow-scoped subscription on
 * the shared Socket.IO connection and a small reactive store of *remote*
 * participants (the local user is never rendered as a peer).
 *
 * Cursor positions are intentionally kept out of the reactive store — they
 * arrive ~30×/s per peer and are consumed by a requestAnimationFrame loop, so
 * routing them through React would be pure overhead. They live in a module-level
 * map (flow-space coordinates + a timestamp for staleness).
 */

/** A live remote cursor target, in flow-space coordinates. */
export interface CursorTarget {
  x: number;
  y: number;
  /** Last update time (ms), used to fade out stale cursors. */
  at: number;
}

interface PresenceStore {
  connected: boolean;
  /** Remote participants keyed by socket id. */
  participants: Record<string, Participant>;
  /** Each remote participant's selected node ids. */
  selections: Record<string, string[]>;
  /** Each remote participant's currently-edited node id (soft lock). */
  editing: Record<string, string | null>;
}

export const usePresence = create<PresenceStore>(() => ({
  connected: false,
  participants: {},
  selections: {},
  editing: {},
}));

// ── Module-level transient state ─────────────────────────────────────────────
const cursorTargets = new Map<string, CursorTarget>();
/** A remote cursor is considered stale (hidden) after this long without an update. */
export const CURSOR_STALE_MS = 4000;

export function getCursorTargets(): Map<string, CursorTarget> {
  return cursorTargets;
}

let activeWorkflowId: string | null = null;
let onRemoteOps: ((ops: GraphOp[]) => void) | null = null;
// Re-sent verbatim on reconnect so a new socket id restores its room state.
let lastSelection: string[] = [];
let lastEditing: string | null = null;

interface Listeners {
  connect: () => void;
  sync: (p: PresenceSyncPayload) => void;
  joined: (p: PresenceJoinedPayload) => void;
  left: (p: PresenceLeftPayload) => void;
  cursor: (p: PresenceCursorPayload) => void;
  selection: (p: PresenceSelectionPayload) => void;
  editing: (p: PresenceEditingPayload) => void;
  graph: (p: GraphApplyPayload) => void;
}
let listeners: Listeners | null = null;

/**
 * Join a workflow's presence room and start mirroring peers into the store.
 * `onGraphOps` receives graph edits applied by other editors (merged by the
 * caller). Idempotent per workflow; switching workflows re-joins cleanly.
 */
export function connectPresence(workflowId: string, onGraphOps: (ops: GraphOp[]) => void): void {
  if (activeWorkflowId === workflowId && listeners) return;
  disconnectPresence();

  activeWorkflowId = workflowId;
  onRemoteOps = onGraphOps;
  const socket = getSocket();

  const join = () => {
    socket.emit(PRESENCE_JOIN, { workflowId });
    // Restore our awareness state onto the fresh socket after a reconnect.
    if (lastSelection.length) socket.emit(PRESENCE_SELECTION, { workflowId, nodeIds: lastSelection });
    if (lastEditing) socket.emit(PRESENCE_EDITING, { workflowId, nodeId: lastEditing });
    usePresence.setState({ connected: true });
  };

  const ls: Listeners = {
    connect: () => join(),
    sync: ({ participants }) => {
      const next: PresenceStore["participants"] = {};
      const sel: PresenceStore["selections"] = {};
      const edit: PresenceStore["editing"] = {};
      for (const p of participants) {
        next[p.socketId] = {
          socketId: p.socketId,
          userId: p.userId,
          name: p.name,
          avatarUrl: p.avatarUrl,
          color: p.color,
        };
        sel[p.socketId] = p.selection;
        edit[p.socketId] = p.editingNodeId;
      }
      usePresence.setState({ participants: next, selections: sel, editing: edit });
    },
    joined: ({ participant }) => {
      usePresence.setState((s) => ({ participants: { ...s.participants, [participant.socketId]: participant } }));
    },
    left: ({ socketId }) => {
      cursorTargets.delete(socketId);
      usePresence.setState((s) => ({
        participants: omit(s.participants, socketId),
        selections: omit(s.selections, socketId),
        editing: omit(s.editing, socketId),
      }));
    },
    cursor: ({ socketId, x, y }) => {
      cursorTargets.set(socketId, { x, y, at: Date.now() });
    },
    selection: ({ socketId, nodeIds }) => {
      usePresence.setState((s) => ({ selections: { ...s.selections, [socketId]: nodeIds } }));
    },
    editing: ({ socketId, nodeId }) => {
      usePresence.setState((s) => ({ editing: { ...s.editing, [socketId]: nodeId } }));
    },
    graph: ({ ops }) => onRemoteOps?.(ops),
  };

  socket.on("connect", ls.connect);
  socket.on(PRESENCE_SYNC, ls.sync);
  socket.on(PRESENCE_JOINED, ls.joined);
  socket.on(PRESENCE_LEFT, ls.left);
  socket.on(PRESENCE_CURSOR, ls.cursor);
  socket.on(PRESENCE_SELECTION, ls.selection);
  socket.on(PRESENCE_EDITING, ls.editing);
  socket.on(GRAPH_APPLY, ls.graph);
  listeners = ls;

  if (socket.connected) join();
}

/** Leave the room, detach listeners, and reset all presence state. */
export function disconnectPresence(): void {
  flushMoves();
  if (activeWorkflowId && listeners) {
    const socket = getSocket();
    socket.emit(PRESENCE_LEAVE, { workflowId: activeWorkflowId });
    socket.off("connect", listeners.connect);
    socket.off(PRESENCE_SYNC, listeners.sync);
    socket.off(PRESENCE_JOINED, listeners.joined);
    socket.off(PRESENCE_LEFT, listeners.left);
    socket.off(PRESENCE_CURSOR, listeners.cursor);
    socket.off(PRESENCE_SELECTION, listeners.selection);
    socket.off(PRESENCE_EDITING, listeners.editing);
    socket.off(GRAPH_APPLY, listeners.graph);
  }
  listeners = null;
  activeWorkflowId = null;
  onRemoteOps = null;
  lastSelection = [];
  lastEditing = null;
  cursorTargets.clear();
  usePresence.setState({ connected: false, participants: {}, selections: {}, editing: {} });
}

// ── Outbound (throttled where it matters) ────────────────────────────────────
let cursorAt = 0;
const CURSOR_INTERVAL_MS = 40;

/** Broadcast the local cursor, in flow-space coordinates. Throttled to ~25/s. */
export function sendCursor(x: number, y: number): void {
  if (!activeWorkflowId) return;
  const now = Date.now();
  if (now - cursorAt < CURSOR_INTERVAL_MS) return;
  cursorAt = now;
  getSocket().emit(PRESENCE_CURSOR, { workflowId: activeWorkflowId, x, y });
}

/** Broadcast the local node selection (no-op if unchanged). */
export function sendSelection(nodeIds: string[]): void {
  if (!activeWorkflowId) return;
  if (sameIds(nodeIds, lastSelection)) return;
  lastSelection = nodeIds;
  getSocket().emit(PRESENCE_SELECTION, { workflowId: activeWorkflowId, nodeIds });
}

/** Broadcast the node the local user is editing (soft lock), or null to release. */
export function sendEditing(nodeId: string | null): void {
  if (!activeWorkflowId) return;
  if (nodeId === lastEditing) return;
  lastEditing = nodeId;
  getSocket().emit(PRESENCE_EDITING, { workflowId: activeWorkflowId, nodeId });
}

// Coalesce high-frequency `move` ops during a drag; everything else flushes now.
const pendingMoves = new Map<string, { id: string; x: number; y: number }>();
let moveTimer: ReturnType<typeof setTimeout> | null = null;
const MOVE_INTERVAL_MS = 50;

function flushMoves(): void {
  if (moveTimer) {
    clearTimeout(moveTimer);
    moveTimer = null;
  }
  if (!activeWorkflowId || pendingMoves.size === 0) return;
  const positions = [...pendingMoves.values()];
  pendingMoves.clear();
  getSocket().emit(GRAPH_APPLY, { workflowId: activeWorkflowId, ops: [{ t: "move", positions }] });
}

/** Broadcast graph edits to peers; `move` ops are coalesced, others sent immediately. */
export function sendGraphOps(ops: GraphOp[]): void {
  if (!activeWorkflowId || ops.length === 0) return;
  const immediate: GraphOp[] = [];
  for (const op of ops) {
    if (op.t === "move") {
      for (const p of op.positions) pendingMoves.set(p.id, p);
    } else {
      immediate.push(op);
    }
  }
  if (pendingMoves.size > 0 && !moveTimer) {
    moveTimer = setTimeout(() => {
      moveTimer = null;
      flushMoves();
    }, MOVE_INTERVAL_MS);
  }
  if (immediate.length > 0) {
    flushMoves(); // keep ordering: pending moves land before structural ops
    getSocket().emit(GRAPH_APPLY, { workflowId: activeWorkflowId, ops: immediate });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
