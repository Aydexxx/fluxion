import { describe, expect, it } from "vitest";
import { isValidCron } from "../cron";
import {
  computeDesiredSchedules,
  schedulerId,
  syncSchedules,
  type DesiredSchedule,
  type SchedulableWorkflow,
  type SchedulerPort,
} from "../sync";
import type { WorkflowDefinition } from "../../dag/types";

function scheduleNode(id: string, cron: string) {
  return { id, type: "trigger.schedule", position: { x: 0, y: 0 }, config: { cron } };
}

function workflow(over: Partial<SchedulableWorkflow> & { definition: WorkflowDefinition }): SchedulableWorkflow {
  return { id: "wf1", isActive: true, ...over };
}

/** In-memory scheduler backend that records register/cancel calls. */
class FakeSchedulerPort implements SchedulerPort {
  registered = new Map<string, DesiredSchedule>();
  removed: string[] = [];

  async list(workflowId: string): Promise<string[]> {
    return [...this.registered.keys()].filter((k) => k.startsWith(`wf:${workflowId}:`));
  }
  async upsert(schedule: DesiredSchedule): Promise<void> {
    this.registered.set(schedule.schedulerId, schedule);
  }
  async remove(id: string): Promise<void> {
    this.registered.delete(id);
    this.removed.push(id);
  }
}

describe("isValidCron", () => {
  it("accepts standard 5-field and 6-field expressions", () => {
    expect(isValidCron("0 * * * *")).toBe(true);
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1")).toBe(true);
    expect(isValidCron("30 0 1 1 *")).toBe(true);
    expect(isValidCron("0 0 9 * * *")).toBe(true); // with seconds
  });

  it("rejects malformed or non-string input", () => {
    expect(isValidCron("nonsense")).toBe(false);
    expect(isValidCron("* * *")).toBe(false); // too few fields
    expect(isValidCron("")).toBe(false);
    expect(isValidCron(undefined)).toBe(false);
    expect(isValidCron(42)).toBe(false);
  });
});

describe("computeDesiredSchedules", () => {
  it("includes one schedule per valid schedule node when active", () => {
    const wf = workflow({
      definition: { nodes: [scheduleNode("s1", "0 * * * *"), { id: "o", type: "output.response", position: { x: 0, y: 0 }, config: {} }], edges: [] },
    });
    expect(computeDesiredSchedules(wf)).toEqual([
      { schedulerId: schedulerId("wf1", "s1"), workflowId: "wf1", nodeId: "s1", cron: "0 * * * *" },
    ]);
  });

  it("desires nothing when the workflow is inactive", () => {
    const wf = workflow({ isActive: false, definition: { nodes: [scheduleNode("s1", "0 * * * *")], edges: [] } });
    expect(computeDesiredSchedules(wf)).toEqual([]);
  });

  it("skips schedule nodes with an invalid cron", () => {
    const wf = workflow({ definition: { nodes: [scheduleNode("s1", "not-a-cron")], edges: [] } });
    expect(computeDesiredSchedules(wf)).toEqual([]);
  });
});

describe("syncSchedules", () => {
  it("registers schedules for an active workflow", async () => {
    const port = new FakeSchedulerPort();
    await syncSchedules(workflow({ definition: { nodes: [scheduleNode("s1", "0 * * * *")], edges: [] } }), port);

    expect([...port.registered.keys()]).toEqual([schedulerId("wf1", "s1")]);
    expect(port.registered.get(schedulerId("wf1", "s1"))?.cron).toBe("0 * * * *");
  });

  it("cancels all schedules when the workflow is deactivated", async () => {
    const port = new FakeSchedulerPort();
    const def: WorkflowDefinition = { nodes: [scheduleNode("s1", "0 * * * *")], edges: [] };
    await syncSchedules(workflow({ definition: def }), port); // active -> registered

    await syncSchedules(workflow({ isActive: false, definition: def }), port); // disable

    expect(port.registered.size).toBe(0);
    expect(port.removed).toContain(schedulerId("wf1", "s1"));
  });

  it("updates the cron in place when edited (same scheduler id)", async () => {
    const port = new FakeSchedulerPort();
    await syncSchedules(workflow({ definition: { nodes: [scheduleNode("s1", "0 * * * *")], edges: [] } }), port);
    await syncSchedules(workflow({ definition: { nodes: [scheduleNode("s1", "*/5 * * * *")], edges: [] } }), port);

    expect(port.registered.size).toBe(1);
    expect(port.registered.get(schedulerId("wf1", "s1"))?.cron).toBe("*/5 * * * *");
  });

  it("removes a schedule when its node is deleted", async () => {
    const port = new FakeSchedulerPort();
    await syncSchedules(workflow({ definition: { nodes: [scheduleNode("s1", "0 * * * *")], edges: [] } }), port);
    await syncSchedules(workflow({ definition: { nodes: [], edges: [] } }), port);

    expect(port.registered.size).toBe(0);
    expect(port.removed).toContain(schedulerId("wf1", "s1"));
  });
});
