import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { NodeExecutionRecord, RunRecord, RunRecorder } from "./persistence";
import type { ExecutionStatusValue, RunTriggerValue } from "./types";

/** `Json?` columns accept any JSON-serializable value; this is the single cast boundary into Prisma's input type. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? null) as Prisma.InputJsonValue;
}

/**
 * Prisma-backed `RunRecorder`: persists the run as a `WorkflowRun` row and each
 * node as a `NodeExecution` row, updating both as the run progresses so the
 * stored state is always live (running -> success/failed) rather than written
 * only at the end.
 */
export class PrismaRunRecorder implements RunRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueueRun(data: { workflowId: string; trigger: RunTriggerValue; payload: unknown }): Promise<string> {
    const run = await this.prisma.workflowRun.create({
      data: {
        workflowId: data.workflowId,
        trigger: data.trigger,
        status: "queued",
        payload: toJson(data.payload),
      },
      select: { id: true },
    });
    return run.id;
  }

  async beginRun(runId: string): Promise<void> {
    // Discard a previous attempt's node executions so a retry starts clean.
    await this.prisma.nodeExecution.deleteMany({ where: { runId } });
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: new Date(), finishedAt: null, error: null },
    });
  }

  async requeueRun(runId: string): Promise<void> {
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: "queued", finishedAt: null, error: null },
    });
  }

  async createNodeExecution(data: { runId: string; nodeId: string; input: unknown }): Promise<string> {
    const node = await this.prisma.nodeExecution.create({
      data: {
        runId: data.runId,
        nodeId: data.nodeId,
        status: "running",
        startedAt: new Date(),
        input: toJson(data.input),
      },
      select: { id: true },
    });
    return node.id;
  }

  async finishNodeExecution(
    id: string,
    data: { status: ExecutionStatusValue; output?: unknown; error?: string | null },
  ): Promise<void> {
    await this.prisma.nodeExecution.update({
      where: { id },
      data: {
        status: data.status,
        output: data.output === undefined ? undefined : toJson(data.output),
        error: data.error ?? null,
        finishedAt: new Date(),
      },
    });
  }

  async finishRun(id: string, data: { status: ExecutionStatusValue; error?: string | null }): Promise<void> {
    await this.prisma.workflowRun.update({
      where: { id },
      data: { status: data.status, error: data.error ?? null, finishedAt: new Date() },
    });
  }

  async getRun(id: string): Promise<RunRecord> {
    const run = await this.prisma.workflowRun.findUniqueOrThrow({
      where: { id },
      include: { nodeExecutions: { orderBy: { startedAt: "asc" } } },
    });

    const nodeExecutions: NodeExecutionRecord[] = run.nodeExecutions.map((node) => ({
      id: node.id,
      nodeId: node.nodeId,
      status: node.status as ExecutionStatusValue,
      input: node.input ?? null,
      output: node.output ?? null,
      error: node.error,
      startedAt: node.startedAt?.toISOString() ?? null,
      finishedAt: node.finishedAt?.toISOString() ?? null,
    }));

    return {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status as ExecutionStatusValue,
      trigger: run.trigger as RunTriggerValue,
      payload: run.payload ?? null,
      error: run.error,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      nodeExecutions,
    };
  }
}
