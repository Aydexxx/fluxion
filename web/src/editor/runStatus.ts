import type { ExecutionStatus } from "../lib/types";

/** Visual status a node can be in on the canvas. "idle" covers never-run and skipped. */
export type NodeRunStatus = "idle" | "running" | "success" | "failed";

export interface StatusVisual {
  label: string;
  /** Resolved CSS color for dots, rings, and text accents. */
  color: string;
}

const VISUALS: Record<NodeRunStatus, StatusVisual> = {
  idle: { label: "Idle", color: "color-mix(in oklab, white 40%, transparent)" },
  running: { label: "Running", color: "#e0a33e" },
  success: { label: "Success", color: "#34d0a8" },
  failed: { label: "Failed", color: "#ff6b6b" },
};

export function statusVisual(status: NodeRunStatus): StatusVisual {
  return VISUALS[status];
}

/** Map a backend execution status onto the canvas status vocabulary. */
export function toNodeRunStatus(status: ExecutionStatus): NodeRunStatus {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "running":
    case "queued":
      return "running";
    default:
      return "idle";
  }
}
