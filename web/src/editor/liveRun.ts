import { getSocket } from "../lib/socket";
import { RUN_EVENT, RUN_SUBSCRIBE, RUN_UNSUBSCRIBE, type RunLiveEvent } from "../lib/realtimeEvents";

let current: { runId: string; handler: (event: RunLiveEvent) => void } | null = null;

/**
 * Subscribe to a run's live events. Joins the run's Socket.IO room and forwards
 * matching events to `onEvent`. Only one live run is tracked at a time — a new
 * subscription replaces the previous one.
 */
export function subscribeToRun(runId: string, onEvent: (event: RunLiveEvent) => void): void {
  unsubscribeFromRun();
  const socket = getSocket();
  const handler = (event: RunLiveEvent) => {
    if (event.runId === runId) onEvent(event);
  };
  socket.on(RUN_EVENT, handler);
  socket.emit(RUN_SUBSCRIBE, { runId });
  current = { runId, handler };
}

export function unsubscribeFromRun(): void {
  if (!current) return;
  const socket = getSocket();
  socket.off(RUN_EVENT, current.handler);
  socket.emit(RUN_UNSUBSCRIBE, { runId: current.runId });
  current = null;
}
