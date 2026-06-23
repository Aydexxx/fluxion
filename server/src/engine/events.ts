import type { ExecutionStatusValue } from "./types";

/**
 * Lifecycle events emitted while a workflow run executes. The orchestrator
 * calls a `RunEventSink` at each transition; the worker wires that sink to
 * Socket.IO so the editor can light up nodes in real time. Kept free of any
 * transport dependency so the engine stays pure and unit-testable.
 */
export type RunEvent =
  | { type: "run:started"; runId: string; workflowId: string }
  | { type: "node:started"; runId: string; nodeId: string }
  | { type: "node:finished"; runId: string; nodeId: string; status: ExecutionStatusValue; error?: string | null }
  | { type: "run:finished"; runId: string; status: ExecutionStatusValue; error?: string | null };

export type RunEventSink = (event: RunEvent) => void;

/** No-op sink for the standalone/synchronous path and tests that don't assert events. */
export const noopEventSink: RunEventSink = () => {};
