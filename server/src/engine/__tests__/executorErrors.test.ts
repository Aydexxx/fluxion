import { describe, expect, it, vi } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import { resolveCredential } from "../executors/credentialUtil";
import { readArrayInput, lookupPath } from "../executors/collections";
import { outputResponseExecutor } from "../executors/outputResponse";
import { manualTriggerExecutor, webhookTriggerExecutor, scheduleTriggerExecutor } from "../executors/triggerManual";
import type {
  CredentialAccessor,
  CredentialSecret,
  DbQueryRunner,
  EmailSender,
  ExecutionContext,
  LlmSettings,
  NodeInput,
} from "../types";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../../dag/types";

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
};

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target };
}

function accessorFrom(map: Record<string, CredentialSecret>): CredentialAccessor {
  return { async resolve(id) { return map[id] ?? null; } };
}

interface RunOptions {
  payload?: unknown;
  credentials?: Record<string, CredentialSecret>;
  email?: EmailSender;
  db?: DbQueryRunner;
  fetchImpl?: typeof fetch;
}

async function run(definition: WorkflowDefinition, options: RunOptions = {}): Promise<RunRecord> {
  const recorder = new InMemoryRunRecorder();
  const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: options.payload ?? null });
  return runWorkflow({
    runId,
    workflowId: "wf",
    workspaceId: "ws",
    definition,
    trigger: { type: "manual", payload: options.payload ?? null },
    registry: createDefaultRegistry(),
    recorder,
    llm,
    credentials: options.credentials ? accessorFrom(options.credentials) : undefined,
    email: options.email,
    db: options.db,
    fetchImpl: options.fetchImpl,
  });
}

const errorOf = (r: RunRecord, id: string) => r.nodeExecutions.find((n) => n.nodeId === id)?.error;

function baseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workspaceId: "ws",
    trigger: null,
    credentials: accessorFrom({}),
    llm,
    fetch: vi.fn() as unknown as typeof fetch,
    ...overrides,
  };
}

function input(sources: Record<string, unknown> = {}, trigger: unknown = null): NodeInput {
  return { trigger, sources };
}

describe("resolveCredential", () => {
  it("rejects a missing/blank credentialId", async () => {
    await expect(resolveCredential(baseContext(), undefined, "smtp")).rejects.toThrow(/requires a smtp credential/);
    await expect(resolveCredential(baseContext(), "  ", "smtp")).rejects.toThrow(/requires a smtp credential/);
  });

  it("rejects an id not found in the workspace", async () => {
    await expect(resolveCredential(baseContext(), "missing", "smtp")).rejects.toThrow(/was not found in this workspace/);
  });

  it("rejects a credential of the wrong type", async () => {
    const ctx = baseContext({ credentials: accessorFrom({ c1: { type: "http_bearer", data: {} } }) });
    await expect(resolveCredential(ctx, "c1", "smtp")).rejects.toThrow(/is a http_bearer, but this node needs a smtp/);
  });

  it("returns the decrypted secret when the type matches", async () => {
    const secret: CredentialSecret = { type: "smtp", data: { host: "smtp.x.com" } };
    const ctx = baseContext({ credentials: accessorFrom({ c1: secret }) });
    await expect(resolveCredential(ctx, "c1", "smtp")).resolves.toEqual(secret);
  });
});

describe("readArrayInput", () => {
  it("prefers an explicit array of items", () => {
    expect(readArrayInput([1, 2], input({ a: [9] }))).toEqual([1, 2]);
  });

  it("falls back to a single upstream array output", () => {
    expect(readArrayInput(undefined, input({ a: [1, 2, 3] }))).toEqual([1, 2, 3]);
  });

  it("unwraps a single upstream output's .items array", () => {
    expect(readArrayInput(undefined, input({ a: { items: [1, 2] } }))).toEqual([1, 2]);
  });

  it("returns [] when nothing array-shaped is found", () => {
    expect(readArrayInput(undefined, input({}))).toEqual([]);
    expect(readArrayInput(undefined, input({ a: { x: 1 }, b: { y: 2 } }))).toEqual([]); // more than one source
    expect(readArrayInput("not-an-array", input({}))).toEqual([]);
  });
});

describe("lookupPath", () => {
  it("returns the item itself for an empty path", () => {
    expect(lookupPath({ a: 1 }, "")).toEqual({ a: 1 });
  });

  it("walks a dotted path through nested objects", () => {
    expect(lookupPath({ user: { contact: { email: "a@x" } } }, "user.contact.email")).toBe("a@x");
  });

  it("returns undefined when a segment is missing or the item isn't an object", () => {
    expect(lookupPath({ user: { name: "Ada" } }, "user.email")).toBeUndefined();
    expect(lookupPath(null, "user.email")).toBeUndefined();
    expect(lookupPath("a string", "length")).toBeUndefined();
  });
});

describe("outputResponseExecutor", () => {
  it("returns config.body as the response payload", async () => {
    const out = await outputResponseExecutor.execute(node("o", "output.response", { body: { ok: true } }), input(), baseContext());
    expect(out).toEqual({ body: { ok: true } });
  });

  it("defaults to a null body when none is configured", async () => {
    const out = await outputResponseExecutor.execute(node("o", "output.response"), input(), baseContext());
    expect(out).toEqual({ body: null });
  });
});

describe("trigger passthrough executors", () => {
  it("each returns the run's trigger payload unchanged", async () => {
    const ctx = baseContext({ trigger: { hello: "world" } });
    await expect(manualTriggerExecutor.execute(node("t", "trigger.manual"), input(), ctx)).resolves.toEqual({ hello: "world" });
    await expect(webhookTriggerExecutor.execute(node("t", "trigger.webhook"), input(), ctx)).resolves.toEqual({ hello: "world" });
    await expect(scheduleTriggerExecutor.execute(node("t", "trigger.schedule"), input(), ctx)).resolves.toEqual({ hello: "world" });
  });

  it("falls back to null when the run has no trigger payload", async () => {
    const ctx = baseContext({ trigger: undefined });
    await expect(manualTriggerExecutor.execute(node("t", "trigger.manual"), input(), ctx)).resolves.toBeNull();
  });
});

describe("action.database — error paths", () => {
  const okRunner = (): DbQueryRunner => ({ async query() { return { rows: [], rowCount: 0 }; } });

  it("fails when no database client is configured for the run", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("q", "action.database", { credentialId: "c1", query: "SELECT 1" })],
      edges: [edge("e1", "t", "q")],
    };
    const result = await run(def, { credentials: { c1: { type: "database", data: { connectionString: "postgres://x" } } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "q")).toMatch(/Database client is not configured/);
  });

  it("fails when the query is blank", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("q", "action.database", { credentialId: "c1", query: "  " })],
      edges: [edge("e1", "t", "q")],
    };
    const result = await run(def, { credentials: { c1: { type: "database", data: { connectionString: "postgres://x" } } }, db: okRunner() });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "q")).toMatch(/requires a 'query'/);
  });

  it("fails when the resolved credential is missing a connectionString", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("q", "action.database", { credentialId: "c1", query: "SELECT 1" })],
      edges: [edge("e1", "t", "q")],
    };
    const result = await run(def, { credentials: { c1: { type: "database", data: {} } }, db: okRunner() });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "q")).toMatch(/missing its connectionString/);
  });
});

describe("action.email — error paths", () => {
  const stubEmail: EmailSender = { async send() { return { messageId: "x", accepted: [] }; } };

  it("fails when no email transport is configured for the run", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("m", "action.email", { credentialId: "c1", to: "a@x.com" })],
      edges: [edge("e1", "t", "m")],
    };
    const result = await run(def, { credentials: { c1: { type: "smtp", data: { host: "smtp.x.com" } } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "m")).toMatch(/Email transport is not configured/);
  });

  it("fails when 'to' is blank", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("m", "action.email", { credentialId: "c1", to: "  " })],
      edges: [edge("e1", "t", "m")],
    };
    const result = await run(def, { credentials: { c1: { type: "smtp", data: { host: "smtp.x.com" } } }, email: stubEmail });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "m")).toMatch(/requires a 'to' address/);
  });

  it("fails when the resolved SMTP credential is missing a host", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("m", "action.email", { credentialId: "c1", to: "a@x.com" })],
      edges: [edge("e1", "t", "m")],
    };
    const result = await run(def, { credentials: { c1: { type: "smtp", data: {} } }, email: stubEmail });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "m")).toMatch(/missing its host/);
  });
});

describe("action.slack — error paths", () => {
  it("fails when the resolved credential is missing a url", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("s", "action.slack", { credentialId: "c1", text: "hi" })],
      edges: [edge("e1", "t", "s")],
    };
    const result = await run(def, { credentials: { c1: { type: "slack_webhook", data: {} } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "s")).toMatch(/missing its url/);
  });

  it("fails when the webhook responds with a non-2xx status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("s", "action.slack", { credentialId: "c1", text: "hi" })],
      edges: [edge("e1", "t", "s")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "slack_webhook", data: { url: "https://hooks.slack.com/services/x" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "s")).toMatch(/responded with status 500/);
  });
});
