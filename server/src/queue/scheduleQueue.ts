import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";

export const WORKFLOW_SCHEDULES_QUEUE = "workflow-schedules";

/** Payload of a schedule-fire job (one per cron tick of a schedule node). */
export interface ScheduleJobData {
  workflowId: string;
  nodeId: string;
}

let queue: Queue<ScheduleJobData> | null = null;

/**
 * Queue that holds BullMQ job schedulers (repeatable cron jobs). Each tick
 * produces a job the scheduler worker turns into a real workflow run. Lazily
 * constructed so importing this module doesn't open a Redis connection.
 */
export function getScheduleQueue(): Queue<ScheduleJobData> {
  if (!queue) {
    queue = new Queue<ScheduleJobData>(WORKFLOW_SCHEDULES_QUEUE, {
      connection: createRedisConnection(),
    });
  }
  return queue;
}
