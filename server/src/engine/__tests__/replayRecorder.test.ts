import { describe, expect, it } from "vitest";
import { InMemoryRunRecorder } from "../persistence";

describe("RunRecorder replay lineage", () => {
  it("persists replayOfId + createdAt on enqueue and returns them from getRun", async () => {
    const recorder = new InMemoryRunRecorder();

    const originId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: { topic: "x" } });
    const replayId = await recorder.enqueueRun({
      workflowId: "wf",
      trigger: "manual",
      payload: { topic: "x" },
      replayOfId: originId,
    });

    const origin = await recorder.getRun(originId);
    const replay = await recorder.getRun(replayId);

    expect(origin.replayOfId).toBeNull();
    expect(origin.createdAt).not.toBeNull();

    expect(replay.replayOfId).toBe(originId);
    expect(replay.payload).toEqual({ topic: "x" });
    expect(replay.status).toBe("queued");
  });
});
