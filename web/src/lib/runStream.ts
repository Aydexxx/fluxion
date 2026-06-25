import { getSocket } from "./socket";
import {
  RUN_EVENT,
  RUN_LOG,
  RUN_SUBSCRIBE,
  RUN_UNSUBSCRIBE,
  type RunLiveEvent,
  type RunLogLivePayload,
} from "./realtimeEvents";
import type { RunLogEntry } from "./types";

/**
 * Live subscription to a single run's room — both lifecycle events (node/run
 * status) and structured log lines. Used by the run detail view to stream an
 * in-progress run. Independent of the editor's `liveRun` (which only needs
 * status events for the canvas); a detail view and the editor never run at once.
 */
export interface RunStreamHandlers {
  onEvent?: (event: RunLiveEvent) => void;
  onLog?: (entry: RunLogEntry) => void;
}

export interface RunStreamSubscription {
  unsubscribe: () => void;
}

export function subscribeRunStream(runId: string, handlers: RunStreamHandlers): RunStreamSubscription {
  const socket = getSocket();

  const eventHandler = (event: RunLiveEvent) => {
    if (event.runId === runId) handlers.onEvent?.(event);
  };
  const logHandler = (payload: RunLogLivePayload) => {
    if (payload.runId === runId) handlers.onLog?.(payload.entry);
  };

  socket.on(RUN_EVENT, eventHandler);
  socket.on(RUN_LOG, logHandler);
  socket.emit(RUN_SUBSCRIBE, { runId });

  return {
    unsubscribe: () => {
      socket.off(RUN_EVENT, eventHandler);
      socket.off(RUN_LOG, logHandler);
      socket.emit(RUN_UNSUBSCRIBE, { runId });
    },
  };
}
