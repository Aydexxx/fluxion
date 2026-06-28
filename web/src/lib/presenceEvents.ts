// Mirror of the server's presence contract (server/src/realtime/presence.ts).
// Real-time, ephemeral multi-user awareness over a workflow-scoped Socket.IO room.

// Client -> server
export const PRESENCE_JOIN = "presence:join";
export const PRESENCE_LEAVE = "presence:leave";
export const PRESENCE_CURSOR = "presence:cursor";
export const PRESENCE_SELECTION = "presence:selection";
export const PRESENCE_EDITING = "presence:editing";
export const GRAPH_APPLY = "graph:apply";
// Server -> client
export const PRESENCE_SYNC = "presence:sync";
export const PRESENCE_JOINED = "presence:joined";
export const PRESENCE_LEFT = "presence:left";

/** A participant's stable identity within a workflow room. */
export interface Participant {
  /** Per-tab socket id — the unit of presence. */
  socketId: string;
  userId: string;
  name: string;
  /** The user's avatar (data URL), or null to render initials. */
  avatarUrl: string | null;
  color: string;
}

/** A participant plus their current awareness state (sent in the join roster). */
export interface ParticipantState extends Participant {
  selection: string[];
  editingNodeId: string | null;
}

// ── Server -> client payloads ────────────────────────────────────────────────
export interface PresenceSyncPayload {
  participants: ParticipantState[];
}
export interface PresenceJoinedPayload {
  participant: Participant;
}
export interface PresenceLeftPayload {
  socketId: string;
  userId: string;
}
export interface PresenceCursorPayload {
  socketId: string;
  x: number;
  y: number;
}
export interface PresenceSelectionPayload {
  socketId: string;
  nodeIds: string[];
}
export interface PresenceEditingPayload {
  socketId: string;
  userId: string;
  name: string;
  nodeId: string | null;
}

// ── Graph sync ───────────────────────────────────────────────────────────────
/** A node serialized for the wire — transient flags (selected/measured) stripped. */
export interface SerializedNode {
  id: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  style?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/**
 * A graph edit broadcast to peers and merged last-write-wins. Positions merge by
 * overwrite (the simplest robust rule); a full `replace` is used for wholesale
 * changes like undo/redo where a diff would be fragile.
 */
export type GraphOp =
  | { t: "move"; positions: Array<{ id: string; x: number; y: number }> }
  | { t: "upsert"; nodes?: SerializedNode[]; edges?: SerializedEdge[] }
  | { t: "remove"; nodeIds?: string[]; edgeIds?: string[] }
  | { t: "replace"; nodes: SerializedNode[]; edges: SerializedEdge[] };

export interface GraphApplyPayload {
  from: string;
  ops: GraphOp[];
}
