import { describe, expect, it, vi } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import type {
  CredentialAccessor,
  CredentialSecret,
  DbQueryRunner,
  EmailSender,
  LlmSettings,
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

function edge(id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return { id, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
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

const outputOf = (r: RunRecord, id: string) => r.nodeExecutions.find((n) => n.nodeId === id)?.output;
const errorOf = (r: RunRecord, id: string) => r.nodeExecutions.find((n) => n.nodeId === id)?.error;

describe("action.slack", () => {
  it("posts the message to the credential's webhook URL", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("s", "action.slack", { credentialId: "c1", text: "hi {{trigger.name}}" })],
      edges: [edge("e1", "t", "s")],
    };

    const result = await run(def, {
      payload: { name: "Ada" },
      credentials: { c1: { type: "slack_webhook", data: { url: "https://hooks.slack.com/services/x" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.status).toBe("success");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hi Ada" });
    expect(outputOf(result, "s")).toEqual({ ok: true, status: 200 });
  });

  it("uses Discord's content field for discord webhook URLs", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("s", "action.slack", { credentialId: "c1", text: "yo" })],
      edges: [edge("e1", "t", "s")],
    };
    await run(def, {
      credentials: { c1: { type: "slack_webhook", data: { url: "https://discord.com/api/webhooks/x" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ content: "yo" });
  });

  it("fails clearly when the wrong credential type is referenced", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("s", "action.slack", { credentialId: "c1", text: "hi" })],
      edges: [edge("e1", "t", "s")],
    };
    const result = await run(def, { credentials: { c1: { type: "http_bearer", data: { token: "x" } } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "s")).toMatch(/needs a slack_webhook/);
  });
});

describe("action.email", () => {
  it("resolves the SMTP credential and sends via the injected transport", async () => {
    const sends: Array<{ smtp: unknown; message: unknown }> = [];
    const email: EmailSender = {
      async send(smtp, message) {
        sends.push({ smtp, message });
        return { messageId: "msg_1", accepted: [message.to] };
      },
    };
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("m", "action.email", {
          credentialId: "c1",
          to: "{{trigger.to}}",
          subject: "Hello {{trigger.name}}",
          text: "Body for {{trigger.name}}",
        }),
      ],
      edges: [edge("e1", "t", "m")],
    };

    const result = await run(def, {
      payload: { to: "ada@x.com", name: "Ada" },
      credentials: {
        c1: { type: "smtp", data: { host: "smtp.x.com", port: "587", username: "u", password: "p", from: "bot@x.com" } },
      },
      email,
    });

    expect(result.status).toBe("success");
    expect(sends).toHaveLength(1);
    expect(sends[0].smtp).toMatchObject({ host: "smtp.x.com", port: 587, username: "u", password: "p" });
    expect(sends[0].message).toMatchObject({ to: "ada@x.com", subject: "Hello Ada", text: "Body for Ada" });
    expect(outputOf(result, "m")).toEqual({ messageId: "msg_1", accepted: ["ada@x.com"] });
  });
});

describe("action.database", () => {
  const okRunner = (sink: unknown[]): DbQueryRunner => ({
    async query(connectionString, sql, params, options) {
      sink.push({ connectionString, sql, params, options });
      return { rows: [{ id: 1 }], rowCount: 1 };
    },
  });

  it("runs a parameterized SELECT read-only by default", async () => {
    const calls: unknown[] = [];
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("q", "action.database", { credentialId: "c1", query: "SELECT * FROM users WHERE id = $1", params: ["{{trigger.id}}"] }),
      ],
      edges: [edge("e1", "t", "q")],
    };
    const result = await run(def, {
      payload: { id: "42" },
      credentials: { c1: { type: "database", data: { connectionString: "postgres://x" } } },
      db: okRunner(calls),
    });

    expect(result.status).toBe("success");
    expect(calls[0]).toMatchObject({
      connectionString: "postgres://x",
      sql: "SELECT * FROM users WHERE id = $1",
      params: ["42"],
      options: { readOnly: true },
    });
    expect(outputOf(result, "q")).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
  });

  it("rejects a write statement when read-only (the default)", async () => {
    const calls: unknown[] = [];
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("q", "action.database", { credentialId: "c1", query: "DELETE FROM users" })],
      edges: [edge("e1", "t", "q")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "database", data: { connectionString: "postgres://x" } } },
      db: okRunner(calls),
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "q")).toMatch(/only allows SELECT/);
    expect(calls).toHaveLength(0);
  });
});

describe("logic.loop / iterate", () => {
  it("projects each item by dotted field paths", async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("l", "logic.loop", { items: "{{trigger.users}}", fields: [{ as: "email", path: "contact.email" }, { as: "name", path: "name" }] }),
      ],
      edges: [edge("e1", "t", "l")],
    };
    const result = await run(def, {
      payload: { users: [{ name: "Ada", contact: { email: "a@x" } }, { name: "Bob", contact: { email: "b@x" } }] },
    });
    expect(outputOf(result, "l")).toEqual({
      items: [{ email: "a@x", name: "Ada" }, { email: "b@x", name: "Bob" }],
      count: 2,
      isEmpty: false,
    });
  });

  it("passes items through unchanged with no fields, and reports empty", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("l", "logic.loop", { items: "{{trigger.list}}" })],
      edges: [edge("e1", "t", "l")],
    };
    const empty = await run(def, { payload: { list: [] } });
    expect(outputOf(empty, "l")).toEqual({ items: [], count: 0, isEmpty: true });

    const some = await run(def, { payload: { list: [1, 2, 3] } });
    expect(outputOf(some, "l")).toEqual({ items: [1, 2, 3], count: 3, isEmpty: false });
  });
});

describe("logic.filter", () => {
  it("keeps items matching a numeric comparison on the item itself", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("f", "logic.filter", { items: "{{trigger.nums}}", operator: ">", value: "2" })],
      edges: [edge("e1", "t", "f")],
    };
    const result = await run(def, { payload: { nums: [1, 2, 3, 4] } });
    expect(outputOf(result, "f")).toEqual({ items: [3, 4], count: 2, removed: 2 });
  });

  it("drops items whose field is falsy", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("f", "logic.filter", { items: "{{trigger.users}}", field: "active", operator: "truthy" })],
      edges: [edge("e1", "t", "f")],
    };
    const result = await run(def, {
      payload: { users: [{ name: "Ada", active: true }, { name: "Bob", active: false }] },
    });
    expect(outputOf(result, "f")).toEqual({ items: [{ name: "Ada", active: true }], count: 1, removed: 1 });
  });

  it("reads its array from a single upstream output when items is omitted", async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("l", "logic.loop", { items: "{{trigger.nums}}" }),
        node("f", "logic.filter", { operator: ">", value: "1" }),
      ],
      edges: [edge("e1", "t", "l"), edge("e2", "l", "f")],
    };
    // loop outputs { items:[...] }; filter reads that wrapped array.
    const result = await run(def, { payload: { nums: [1, 2, 3] } });
    expect(outputOf(result, "f")).toMatchObject({ items: [2, 3], count: 2 });
  });
});
