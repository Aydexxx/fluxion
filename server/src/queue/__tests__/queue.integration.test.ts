import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { createRedisConnection } from "../connection";
import { runJob, type ProcessRunDeps } from "../../worker/processRun";
import { InMemoryRunRecorder } from "../../engine/persistence";
import { createDefaultRegistry } from "../../engine/registry";
import type { LlmSettings } from "../../engine/types";
import type { WorkflowDefinition } from "../../dag/types";

/**
 * Real BullMQ + Redis mechanics. Uses in-memory engine deps (no Postgres), so
 * it only needs a reachable Redis — and self-skips when one isn't available, so
 * the suite stays green in environments without Redis.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function redisReachable(): Promise<boolean> {
  const probe = new IORedis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

// Determined in beforeAll; each test skips itself when Redis isn't reachable
// (top-level await isn't available under this CommonJS target).
let redisAvailable = false;
beforeAll(async () => {
  redisAvailable = await redisReachable();
});

function requireRedis(ctx: TestContext): void {
  if (!redisAvailable) ctx.skip();
}

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

const linearDefinition: WorkflowDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "out", type: "output.response", position: { x: 0, y: 0 }, config: { body: "ok" } },
  ],
  edges: [{ id: "e1", source: "t", target: "out" }],
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const teardowns: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const fn of teardowns) await fn().catch(() => {});
});

/** Unique queue name per test so cases don't bleed into each other. */
function uniqueQueue(): string {
  return `test-runs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

describe("BullMQ queue", () => {
  it("enqueue -> worker -> completion (happy path)", async (ctx) => {
    requireRedis(ctx);
    const name = uniqueQueue();
    const connection = createRedisConnection();
    const queue = new Queue(name, { connection });
    const recorder = new InMemoryRunRecorder();
    const deps: ProcessRunDeps = {
      recorder,
      loadWorkflow: async () => ({ definition: linearDefinition, workspaceId: "ws" }),
      registry: createDefaultRegistry(),
      llm,
    };

    const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: null });

    const done = new Promise<void>((resolve) => {
      const worker = new Worker<{ runId: string }>(name, async (job) => { await runJob(job.data.runId, deps); }, {
        connection: createRedisConnection(),
        concurrency: 1,
      });
      worker.on("completed", () => resolve());
      teardowns.push(() => worker.close());
    });

    await queue.add("run", { runId }, { jobId: runId });
    teardowns.push(() => queue.obliterate({ force: true }).then(() => connection.quit()).then(() => {}));

    await done;
    const run = await recorder.getRun(runId);
    expect(run.status).toBe("success");
  }, 15000);

  it("respects the concurrency limit", async (ctx) => {
    requireRedis(ctx);
    const name = uniqueQueue();
    const connection = createRedisConnection();
    const queue = new Queue(name, { connection });

    let active = 0;
    let maxActive = 0;
    const total = 6;
    const limit = 2;

    const allDone = new Promise<void>((resolve) => {
      let completed = 0;
      const worker = new Worker(name, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(120);
        active -= 1;
      }, { connection: createRedisConnection(), concurrency: limit });
      worker.on("completed", () => {
        completed += 1;
        if (completed === total) resolve();
      });
      teardowns.push(() => worker.close());
    });

    await queue.addBulk(Array.from({ length: total }, (_, i) => ({ name: "run", data: { i } })));
    teardowns.push(() => queue.obliterate({ force: true }).then(() => connection.quit()).then(() => {}));

    await allDone;
    expect(maxActive).toBeLessThanOrEqual(limit);
    expect(maxActive).toBeGreaterThan(1); // proves jobs really did overlap
  }, 20000);

  it("dedupes duplicate enqueues by job id (idempotency)", async (ctx) => {
    requireRedis(ctx);
    const name = uniqueQueue();
    const connection = createRedisConnection();
    const queue = new Queue(name, { connection });

    let processed = 0;
    const worker = new Worker(name, async () => { processed += 1; await delay(20); }, {
      connection: createRedisConnection(),
      concurrency: 1,
    });
    teardowns.push(() => worker.close());

    const jobId = "run-dup-1";
    await queue.add("run", { runId: jobId }, { jobId });
    await queue.add("run", { runId: jobId }, { jobId }); // duplicate — should be ignored
    teardowns.push(() => queue.obliterate({ force: true }).then(() => connection.quit()).then(() => {}));

    await delay(600);
    expect(processed).toBe(1);
  }, 15000);

  it("retries then dead-letters after exhausting attempts", async (ctx) => {
    requireRedis(ctx);
    const name = uniqueQueue();
    const connection = createRedisConnection();
    const queue = new Queue(name, { connection });

    let attempts = 0;
    const maxAttempts = 3;

    const failed = new Promise<number>((resolve) => {
      const worker = new Worker(name, async () => {
        attempts += 1;
        throw new Error("always fails");
      }, { connection: createRedisConnection(), concurrency: 1 });
      worker.on("failed", (job) => {
        if (job && job.attemptsMade >= maxAttempts) resolve(job.attemptsMade);
      });
      teardowns.push(() => worker.close());
    });

    await queue.add("run", { runId: "dl-1" }, { attempts: maxAttempts, backoff: { type: "fixed", delay: 50 } });
    teardowns.push(() => queue.obliterate({ force: true }).then(() => connection.quit()).then(() => {}));

    const finalAttempts = await failed;
    expect(finalAttempts).toBe(maxAttempts);
    expect(attempts).toBe(maxAttempts);
  }, 20000);
});
