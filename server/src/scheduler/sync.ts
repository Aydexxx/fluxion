import type { WorkflowDefinition } from "../dag/types";
import { getScheduleQueue } from "../queue/scheduleQueue";
import { isValidCron } from "./cron";

/** Minimal workflow view the scheduler needs. */
export interface SchedulableWorkflow {
  id: string;
  isActive: boolean;
  definition: WorkflowDefinition;
}

export interface DesiredSchedule {
  schedulerId: string;
  workflowId: string;
  nodeId: string;
  cron: string;
}

/** Stable per-(workflow,node) scheduler id, so edits upsert in place and removals target precisely. */
export function schedulerId(workflowId: string, nodeId: string): string {
  return `wf:${workflowId}:${nodeId}`;
}

/**
 * The schedules a workflow *should* have right now: one per `trigger.schedule`
 * node with a valid cron — but only while the workflow is active. An inactive
 * workflow desires no schedules, so syncing it cancels everything.
 */
export function computeDesiredSchedules(workflow: SchedulableWorkflow): DesiredSchedule[] {
  if (!workflow.isActive) return [];
  const desired: DesiredSchedule[] = [];
  for (const node of workflow.definition.nodes) {
    if (node.type !== "trigger.schedule") continue;
    const cron = node.config?.cron;
    if (!isValidCron(cron)) continue;
    desired.push({ schedulerId: schedulerId(workflow.id, node.id), workflowId: workflow.id, nodeId: node.id, cron });
  }
  return desired;
}

/** Backend the sync reconciles against — abstracted so it can be unit-tested without Redis. */
export interface SchedulerPort {
  /** Scheduler ids currently registered for this workflow. */
  list(workflowId: string): Promise<string[]>;
  upsert(schedule: DesiredSchedule): Promise<void>;
  remove(schedulerId: string): Promise<void>;
}

/**
 * Reconcile a workflow's registered schedules with its desired ones: remove any
 * that should no longer exist (node deleted, cron changed away, deactivated),
 * then upsert the desired set (idempotent — editing a cron replaces in place).
 */
export async function syncSchedules(workflow: SchedulableWorkflow, port: SchedulerPort): Promise<void> {
  const desired = computeDesiredSchedules(workflow);
  const desiredIds = new Set(desired.map((d) => d.schedulerId));

  const existing = await port.list(workflow.id);
  for (const id of existing) {
    if (!desiredIds.has(id)) await port.remove(id);
  }
  for (const schedule of desired) {
    await port.upsert(schedule);
  }
}

/** BullMQ-backed scheduler port using job schedulers (repeatable cron jobs). */
export function bullmqSchedulerPort(): SchedulerPort {
  const queue = getScheduleQueue();
  return {
    async list(workflowId) {
      const schedulers = await queue.getJobSchedulers(0, -1, true);
      const prefix = `wf:${workflowId}:`;
      return schedulers.map((s) => s.key).filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
    },
    async upsert(schedule) {
      await queue.upsertJobScheduler(
        schedule.schedulerId,
        { pattern: schedule.cron },
        { name: "schedule", data: { workflowId: schedule.workflowId, nodeId: schedule.nodeId } },
      );
    },
    async remove(id) {
      await queue.removeJobScheduler(id);
    },
  };
}

/**
 * Sync a workflow's cron schedules with the live BullMQ queue. Best-effort and
 * non-throwing: a scheduler hiccup must never fail the workflow save that
 * triggered it. Run from the workflows service on create/update.
 */
export async function syncWorkflowSchedule(workflow: SchedulableWorkflow): Promise<void> {
  try {
    await syncSchedules(workflow, bullmqSchedulerPort());
  } catch (error) {
    console.error(`[scheduler] failed to sync schedules for workflow ${workflow.id}`, error);
  }
}

/** Remove every schedule for a workflow (used when it's deleted). Best-effort. */
export async function removeWorkflowSchedules(workflowId: string): Promise<void> {
  try {
    const port = bullmqSchedulerPort();
    for (const id of await port.list(workflowId)) await port.remove(id);
  } catch (error) {
    console.error(`[scheduler] failed to remove schedules for workflow ${workflowId}`, error);
  }
}
