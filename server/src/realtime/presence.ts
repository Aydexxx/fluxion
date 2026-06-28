import type { Server as IOServer, Socket } from "socket.io";

/**
 * Real-time multi-user awareness for the editor. Presence is *ephemeral* — it
 * lives entirely in Socket.IO room state and is never persisted. Each open
 * editor tab is one socket; a socket joins exactly one workflow "room" and
 * broadcasts its cursor, selection, editing state, and applied graph edits to
 * the others in that room.
 *
 * The handlers are deliberately decoupled from the Redis adapter and the
 * database via the injected {@link PresenceDeps}, so they can be exercised with
 * a plain in-memory Socket.IO server in tests.
 */

/** Socket.IO room that scopes presence to a single workflow's open editors. */
export function workflowRoom(workflowId: string): string {
  return `wf:${workflowId}`;
}

// ── Wire protocol ───────────────────────────────────────────────────────────
// Client -> server
export const PRESENCE_JOIN = "presence:join";
export const PRESENCE_LEAVE = "presence:leave";
export const PRESENCE_CURSOR = "presence:cursor";
export const PRESENCE_SELECTION = "presence:selection";
export const PRESENCE_EDITING = "presence:editing";
export const GRAPH_APPLY = "graph:apply";
// Server -> client
export const PRESENCE_SYNC = "presence:sync"; // full roster, sent to a joiner
export const PRESENCE_JOINED = "presence:joined"; // one participant joined
export const PRESENCE_LEFT = "presence:left"; // one participant left

/** A participant's stable identity within a workflow room. */
export interface Participant {
  /** Per-tab socket id — the unit of presence (a user may have several). */
  socketId: string;
  userId: string;
  name: string;
  /** The user's avatar (data URL), or null to render initials. */
  avatarUrl: string | null;
  /** Deterministic per-user color, so a person looks the same everywhere. */
  color: string;
}

/** A participant plus their current (ephemeral) awareness state. */
export interface ParticipantState extends Participant {
  selection: string[];
  editingNodeId: string | null;
}

/** Per-socket presence state stashed on `socket.data` (and read back via fetchSockets). */
interface PresenceSocketState {
  workflowId: string;
  participant: Participant;
  selection: string[];
  editingNodeId: string | null;
}

export interface SocketData {
  userId: string;
  presence?: PresenceSocketState;
}

export interface PresenceIdentity {
  name: string;
  avatarUrl: string | null;
}

export interface PresenceDeps {
  /** Resolve whether `userId` may join the workflow's room (workspace membership). */
  authorize: (workflowId: string, userId: string) => Promise<boolean>;
  /** Resolve the display identity (name + avatar) for a user id. */
  resolveIdentity: (userId: string) => Promise<PresenceIdentity>;
}

/** A pleasant, high-contrast palette; users map onto it deterministically. */
const PALETTE = [
  "#5b8cff", // blue
  "#ff7eb6", // pink
  "#3ecf8e", // green
  "#e0a33e", // amber
  "#b98aff", // violet
  "#ff8f6b", // coral
  "#39c6d8", // cyan
  "#d98ae0", // orchid
];

/** Stable color for a user, derived from a small hash of their id. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const MAX_SELECTION = 500;
const MAX_OPS_BYTES = 64 * 1024;

/**
 * Registers all presence handlers on a connected socket. Call once per
 * connection. The socket must already be authenticated (its user id present on
 * `socket.data.userId`).
 */
export function registerPresenceHandlers(io: IOServer, socket: Socket, deps: PresenceDeps): void {
  const data = socket.data as SocketData;

  /** Broadcast a leave for the room the socket is currently in, then clear it. */
  const leaveCurrent = (): void => {
    const state = data.presence;
    if (!state) return;
    socket.to(workflowRoom(state.workflowId)).emit(PRESENCE_LEFT, {
      socketId: socket.id,
      userId: state.participant.userId,
    });
    void socket.leave(workflowRoom(state.workflowId));
    data.presence = undefined;
  };

  socket.on(PRESENCE_JOIN, async (payload: { workflowId?: string }) => {
    const workflowId = payload?.workflowId;
    if (!workflowId) return;
    if (!(await deps.authorize(workflowId, data.userId))) return;

    // One workflow per socket: leaving a previous room keeps rosters honest if
    // a tab navigates between workflows on the same connection.
    if (data.presence && data.presence.workflowId !== workflowId) leaveCurrent();

    const identity = await deps.resolveIdentity(data.userId);
    const participant: Participant = {
      socketId: socket.id,
      userId: data.userId,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      color: colorForUser(data.userId),
    };
    data.presence = { workflowId, participant, selection: [], editingNodeId: null };
    await socket.join(workflowRoom(workflowId));

    // Hand the joiner the existing roster (including others' current selection /
    // editing state so locks render immediately), then announce them to the room.
    const others = await rosterFor(io, workflowId, socket.id);
    socket.emit(PRESENCE_SYNC, { participants: others });
    socket.to(workflowRoom(workflowId)).emit(PRESENCE_JOINED, { participant });
  });

  socket.on(PRESENCE_LEAVE, () => leaveCurrent());

  socket.on(PRESENCE_CURSOR, (payload: { workflowId?: string; x?: number; y?: number }) => {
    const state = data.presence;
    if (!state || state.workflowId !== payload?.workflowId) return;
    if (typeof payload.x !== "number" || typeof payload.y !== "number") return;
    // Cursors are high-frequency and disposable — relayed, never stored.
    socket.to(workflowRoom(state.workflowId)).emit(PRESENCE_CURSOR, {
      socketId: socket.id,
      x: payload.x,
      y: payload.y,
    });
  });

  socket.on(PRESENCE_SELECTION, (payload: { workflowId?: string; nodeIds?: unknown }) => {
    const state = data.presence;
    if (!state || state.workflowId !== payload?.workflowId) return;
    const nodeIds = Array.isArray(payload.nodeIds)
      ? payload.nodeIds.filter((id): id is string => typeof id === "string").slice(0, MAX_SELECTION)
      : [];
    state.selection = nodeIds;
    socket.to(workflowRoom(state.workflowId)).emit(PRESENCE_SELECTION, {
      socketId: socket.id,
      nodeIds,
    });
  });

  socket.on(PRESENCE_EDITING, (payload: { workflowId?: string; nodeId?: string | null }) => {
    const state = data.presence;
    if (!state || state.workflowId !== payload?.workflowId) return;
    const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
    state.editingNodeId = nodeId;
    socket.to(workflowRoom(state.workflowId)).emit(PRESENCE_EDITING, {
      socketId: socket.id,
      userId: state.participant.userId,
      name: state.participant.name,
      nodeId,
    });
  });

  socket.on(GRAPH_APPLY, (payload: { workflowId?: string; ops?: unknown }) => {
    const state = data.presence;
    if (!state || state.workflowId !== payload?.workflowId) return;
    if (!Array.isArray(payload.ops) || payload.ops.length === 0) return;
    // Cheap guard against a runaway payload; the schema itself is trusted within
    // an authorized room (last-write-wins merge happens on the client).
    if (roughByteSize(payload.ops) > MAX_OPS_BYTES) return;
    socket.to(workflowRoom(state.workflowId)).emit(GRAPH_APPLY, {
      from: socket.id,
      ops: payload.ops,
    });
  });

  socket.on("disconnect", () => leaveCurrent());
}

/** Snapshot of every participant in a room except `excludeSocketId`. */
async function rosterFor(io: IOServer, workflowId: string, excludeSocketId: string): Promise<ParticipantState[]> {
  const sockets = await io.in(workflowRoom(workflowId)).fetchSockets();
  const roster: ParticipantState[] = [];
  for (const s of sockets) {
    if (s.id === excludeSocketId) continue;
    const state = (s.data as SocketData).presence;
    if (!state) continue;
    roster.push({ ...state.participant, selection: state.selection, editingNodeId: state.editingNodeId });
  }
  return roster;
}

function roughByteSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Infinity;
  }
}
