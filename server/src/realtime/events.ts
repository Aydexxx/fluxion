import type { RunEvent, RunLogEntry } from "../engine/events";

/** Socket.IO room that scopes run events to subscribers of a single run. */
export function runRoom(runId: string): string {
  return `run:${runId}`;
}

/** Server -> client: a single run lifecycle event (carries the engine `RunEvent`). */
export const RUN_EVENT = "run:event";

/** Server -> client: a single structured log line for a run. Payload: `{ runId, entry }`. */
export const RUN_LOG = "run:log";

/** Client -> server: subscribe/unsubscribe to a run's live events. Payload: `{ runId }`. */
export const RUN_SUBSCRIBE = "run:subscribe";
export const RUN_UNSUBSCRIBE = "run:unsubscribe";

export type { RunEvent, RunLogEntry };
