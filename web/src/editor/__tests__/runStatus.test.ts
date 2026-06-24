import { describe, expect, it } from "vitest";
import { statusVisual, toNodeRunStatus, type NodeRunStatus } from "../runStatus";
import type { ExecutionStatus } from "../../lib/types";

describe("toNodeRunStatus", () => {
  it("maps success and failed straight through", () => {
    expect(toNodeRunStatus("success")).toBe("success");
    expect(toNodeRunStatus("failed")).toBe("failed");
  });

  it("maps both queued and running to the canvas 'running' state", () => {
    expect(toNodeRunStatus("queued")).toBe("running");
    expect(toNodeRunStatus("running")).toBe("running");
  });

  it("falls back to idle for anything else", () => {
    expect(toNodeRunStatus("nonsense" as ExecutionStatus)).toBe("idle");
  });
});

describe("statusVisual", () => {
  it("returns a label and color for every status", () => {
    const statuses: NodeRunStatus[] = ["idle", "running", "success", "failed"];
    for (const status of statuses) {
      const visual = statusVisual(status);
      expect(visual.label).toBeTruthy();
      expect(visual.color).toBeTruthy();
    }
  });
});
