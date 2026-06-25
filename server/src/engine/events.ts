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

export type RunLogLevel = "debug" | "info" | "warn" | "error";

/**
 * A single structured log line emitted while a run executes. `seq` is a
 * monotonic per-run counter assigned by the orchestrator, giving the UI stable
 * ordering and a cursor for incremental fetches. `nodeId` is set for node-scoped
 * lines and null for run-level ones.
 */
export interface RunLogEntry {
  seq: number;
  ts: string;
  level: RunLogLevel;
  message: string;
  nodeId: string | null;
}

/** Receives live log lines for streaming (the worker wires this to Socket.IO). */
export type RunLogSink = (runId: string, entry: RunLogEntry) => void;
