import type { ExecutionStatus } from "./types";

// Mirror of the server's realtime event contract (server/src/realtime/events.ts).
export const RUN_EVENT = "run:event";
export const RUN_SUBSCRIBE = "run:subscribe";
export const RUN_UNSUBSCRIBE = "run:unsubscribe";

/** A single live run lifecycle event pushed by the worker over Socket.IO. */
export type RunLiveEvent =
  | { type: "run:started"; runId: string; workflowId: string }
  | { type: "node:started"; runId: string; nodeId: string }
  | { type: "node:finished"; runId: string; nodeId: string; status: ExecutionStatus; error?: string | null }
  | { type: "run:finished"; runId: string; status: ExecutionStatus; error?: string | null };
