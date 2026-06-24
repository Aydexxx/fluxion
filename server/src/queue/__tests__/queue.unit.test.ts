import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit-level coverage for the BullMQ queue wrappers, fully mocked so it runs
 * without a reachable Redis (see queue.integration.test.ts for the real thing).
 * Verifies our own logic — job-id dedup, default job options, singleton
 * construction, and the scheduler-port adapter — not BullMQ itself.
 */
const { QueueMock, instances } = vi.hoisted(() => {
  const instances: Array<{
    name: string;
    opts: unknown;
    add: ReturnType<typeof vi.fn>;
    getJobSchedulers: ReturnType<typeof vi.fn>;
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    removeJobScheduler: ReturnType<typeof vi.fn>;
  }> = [];
  const QueueMock = vi.fn().mockImplementation(function (name: string, opts: unknown) {
    const instance = {
      name,
      opts,
      add: vi.fn(async () => ({})),
      getJobSchedulers: vi.fn(async () => [
        { key: "wf:wf1:s1" },
        { key: "wf:wf2:s1" },
      ]),
      upsertJobScheduler: vi.fn(async () => ({})),
      removeJobScheduler: vi.fn(async () => ({})),
    };
    instances.push(instance);
    return instance;
  });
  return { QueueMock, instances };
});

vi.mock("bullmq", () => ({ Queue: QueueMock }));
vi.mock("../connection", () => ({ createRedisConnection: vi.fn(() => ({ mockConnection: true })) }));

beforeEach(() => {
  vi.clearAllMocks();
  instances.length = 0;
  vi.resetModules();
});

describe("getWorkflowQueue", () => {
  it("constructs a single BullMQ Queue and reuses it across calls", async () => {
    const { getWorkflowQueue, WORKFLOW_RUNS_QUEUE } = await import("../workflowQueue");
    const a = getWorkflowQueue();
    const b = getWorkflowQueue();
    expect(a).toBe(b);
    expect(QueueMock).toHaveBeenCalledTimes(1);
    expect(QueueMock).toHaveBeenCalledWith(WORKFLOW_RUNS_QUEUE, expect.objectContaining({
      defaultJobOptions: expect.objectContaining({ removeOnFail: false }),
    }));
  });
});

describe("enqueueWorkflowRun", () => {
  it("dedupes by using the run id as the BullMQ job id", async () => {
    const { enqueueWorkflowRun } = await import("../workflowQueue");
    await enqueueWorkflowRun({ runId: "run-1", workflowId: "wf-1", payload: { a: 1 } });

    const queueInstance = instances[0];
    expect(queueInstance.add).toHaveBeenCalledWith(
      "run",
      { runId: "run-1", workflowId: "wf-1", payload: { a: 1 } },
      { jobId: "run-1" },
    );
  });
});

describe("getScheduleQueue", () => {
  it("constructs a single BullMQ Queue named for workflow schedules", async () => {
    const { getScheduleQueue, WORKFLOW_SCHEDULES_QUEUE } = await import("../scheduleQueue");
    const a = getScheduleQueue();
    const b = getScheduleQueue();
    expect(a).toBe(b);
    expect(QueueMock).toHaveBeenCalledTimes(1);
    expect(QueueMock).toHaveBeenCalledWith(WORKFLOW_SCHEDULES_QUEUE, expect.anything());
  });
});

describe("bullmqSchedulerPort", () => {
  it("lists only the scheduler ids for the requested workflow", async () => {
    const { bullmqSchedulerPort } = await import("../../scheduler/sync");
    const port = bullmqSchedulerPort();
    await expect(port.list("wf1")).resolves.toEqual(["wf:wf1:s1"]);
  });

  it("upserts a job scheduler with the cron pattern and job data", async () => {
    const { bullmqSchedulerPort } = await import("../../scheduler/sync");
    const port = bullmqSchedulerPort();
    await port.upsert({ schedulerId: "wf:wf1:s1", workflowId: "wf1", nodeId: "s1", cron: "0 * * * *" });

    const queueInstance = instances[0];
    expect(queueInstance.upsertJobScheduler).toHaveBeenCalledWith(
      "wf:wf1:s1",
      { pattern: "0 * * * *" },
      { name: "schedule", data: { workflowId: "wf1", nodeId: "s1" } },
    );
  });

  it("removes a job scheduler by id", async () => {
    const { bullmqSchedulerPort } = await import("../../scheduler/sync");
    const port = bullmqSchedulerPort();
    await port.remove("wf:wf1:s1");

    const queueInstance = instances[0];
    expect(queueInstance.removeJobScheduler).toHaveBeenCalledWith("wf:wf1:s1");
  });
});
