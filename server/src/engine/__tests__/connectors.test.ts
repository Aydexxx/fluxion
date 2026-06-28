import { describe, expect, it, vi } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import type { CredentialAccessor, CredentialSecret, LlmSettings } from "../types";
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
    fetchImpl: options.fetchImpl,
  });
}

const outputOf = (r: RunRecord, id: string) => r.nodeExecutions.find((n) => n.nodeId === id)?.output;
const errorOf = (r: RunRecord, id: string) => r.nodeExecutions.find((n) => n.nodeId === id)?.error;

/* ── ai.openai ───────────────────────────────────────────────────────────── */

describe("ai.openai", () => {
  it("returns a deterministic stub with no credential, and never calls fetch", async () => {
    const fetchMock = vi.fn();
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("ai", "ai.openai", { model: "gpt-4o-mini", prompt: "Summarize {{trigger.text}}" })],
      edges: [edge("e1", "t", "ai")],
    };
    const result = await run(def, { payload: { text: "the news" }, fetchImpl: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe("success");
    expect(outputOf(result, "ai")).toEqual({
      model: "gpt-4o-mini",
      text: "[stub:gpt-4o-mini] Summarize the news",
      stubbed: true,
      usage: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the Chat Completions API with the resolved credential and returns usage", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Hello Ada" } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("ai", "ai.openai", { credentialId: "c1", model: "gpt-4o", prompt: "Greet {{trigger.name}}", system: "Be brief." }),
      ],
      edges: [edge("e1", "t", "ai")],
    };

    const result = await run(def, {
      payload: { name: "Ada" },
      credentials: { c1: { type: "openai", data: { apiKey: "sk-test" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.status).toBe("success");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Greet Ada" }],
    });
    expect(outputOf(result, "ai")).toEqual({
      model: "gpt-4o",
      text: "Hello Ada",
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
  });

  it("respects a credential's custom baseUrl", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("ai", "ai.openai", { credentialId: "c1", prompt: "hi" })],
      edges: [edge("e1", "t", "ai")],
    };
    await run(def, {
      credentials: { c1: { type: "openai", data: { apiKey: "k", baseUrl: "https://my-proxy.example.com/v1/" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://my-proxy.example.com/v1/chat/completions");
  });

  it("fails clearly when the wrong credential type is referenced", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("ai", "ai.openai", { credentialId: "c1", prompt: "hi" })],
      edges: [edge("e1", "t", "ai")],
    };
    const result = await run(def, { credentials: { c1: { type: "http_bearer", data: { token: "x" } } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "ai")).toMatch(/needs a openai/);
  });

  it("surfaces the API's error message on a non-2xx response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "invalid_api_key" } }), { status: 401 }),
    );
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("ai", "ai.openai", { credentialId: "c1", prompt: "hi" })],
      edges: [edge("e1", "t", "ai")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "openai", data: { apiKey: "bad" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "ai")).toMatch(/401.*invalid_api_key/);
  });
});

/* ── action.github ───────────────────────────────────────────────────────── */

describe("action.github", () => {
  it("creates an issue with the resolved token and parsed labels", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ number: 42, html_url: "https://github.com/acme/widgets/issues/42" }), { status: 201 }),
    );
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("gh", "action.github", {
          credentialId: "c1",
          action: "create_issue",
          repo: "acme/widgets",
          title: "Bug: {{trigger.summary}}",
          body: "Details here",
          labels: "bug, urgent",
        }),
      ],
      edges: [edge("e1", "t", "gh")],
    };

    const result = await run(def, {
      payload: { summary: "crash on save" },
      credentials: { c1: { type: "github_token", data: { token: "ghp_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.status).toBe("success");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/issues");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer ghp_abc", Accept: "application/vnd.github+json" });
    expect(JSON.parse(init.body as string)).toEqual({ title: "Bug: crash on save", body: "Details here", labels: ["bug", "urgent"] });
    expect(outputOf(result, "gh")).toMatchObject({ action: "create_issue", status: 201, data: { number: 42 } });
  });

  it("adds a comment to an existing issue", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 99 }), { status: 201 }));
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("gh", "action.github", { credentialId: "c1", action: "add_comment", repo: "acme/widgets", issueNumber: 42, body: "Fixed in {{trigger.version}}" }),
      ],
      edges: [edge("e1", "t", "gh")],
    };
    const result = await run(def, {
      payload: { version: "v2" },
      credentials: { c1: { type: "github_token", data: { token: "ghp_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/issues/42/comments");
    expect(JSON.parse(init.body as string)).toEqual({ body: "Fixed in v2" });
    expect(outputOf(result, "gh")).toMatchObject({ action: "add_comment", status: 201 });
  });

  it("dispatches a workflow_dispatch event with inputs and handles a 204 response", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("gh", "action.github", {
          credentialId: "c1",
          action: "dispatch_workflow",
          repo: "acme/widgets",
          workflowFile: "deploy.yml",
          ref: "main",
          inputs: [{ key: "environment", value: "{{trigger.env}}" }],
        }),
      ],
      edges: [edge("e1", "t", "gh")],
    };
    const result = await run(def, {
      payload: { env: "staging" },
      credentials: { c1: { type: "github_token", data: { token: "ghp_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("success");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/widgets/actions/workflows/deploy.yml/dispatches");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "main", inputs: { environment: "staging" } });
    expect(outputOf(result, "gh")).toEqual({ action: "dispatch_workflow", status: 204, data: null });
  });

  it("uses a credential's custom baseUrl for GitHub Enterprise", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ number: 1 }), { status: 201 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("gh", "action.github", { credentialId: "c1", repo: "acme/widgets", title: "x" })],
      edges: [edge("e1", "t", "gh")],
    };
    await run(def, {
      credentials: { c1: { type: "github_token", data: { token: "t", baseUrl: "https://ghe.acme.internal/api/v3" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://ghe.acme.internal/api/v3/repos/acme/widgets/issues");
  });

  it("rejects a malformed repo before calling fetch", async () => {
    const fetchMock = vi.fn();
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("gh", "action.github", { credentialId: "c1", repo: "not-a-repo", title: "x" })],
      edges: [edge("e1", "t", "gh")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "github_token", data: { token: "t" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "gh")).toMatch(/'repo' must be "owner\/repo"/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly when the wrong credential type is referenced", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("gh", "action.github", { credentialId: "c1", repo: "acme/widgets", title: "x" })],
      edges: [edge("e1", "t", "gh")],
    };
    const result = await run(def, { credentials: { c1: { type: "openai", data: { apiKey: "x" } } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "gh")).toMatch(/needs a github_token/);
  });

  it("surfaces GitHub's error message on a non-2xx response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("gh", "action.github", { credentialId: "c1", repo: "acme/widgets", title: "x" })],
      edges: [edge("e1", "t", "gh")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "github_token", data: { token: "t" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "gh")).toMatch(/404.*Not Found/);
  });
});

/* ── action.notion ───────────────────────────────────────────────────────── */

describe("action.notion", () => {
  it("creates a page under a page parent, defaulting the title property to 'title'", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "page_1", url: "https://notion.so/page_1" }), { status: 200 }),
    );
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("n", "action.notion", {
          credentialId: "c1",
          action: "create_page",
          parentType: "page",
          parentId: "parent_1",
          title: "Notes for {{trigger.who}}",
          content: "First line",
        }),
      ],
      edges: [edge("e1", "t", "n")],
    };

    const result = await run(def, {
      payload: { who: "Ada" },
      credentials: { c1: { type: "notion_token", data: { token: "secret_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.status).toBe("success");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/pages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret_abc", "Notion-Version": "2022-06-28" });
    expect(JSON.parse(init.body as string)).toEqual({
      parent: { page_id: "parent_1" },
      properties: { title: { title: [{ text: { content: "Notes for Ada" } }] } },
      children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "First line" } }] } }],
    });
    expect(outputOf(result, "n")).toEqual({ action: "create_page", id: "page_1", url: "https://notion.so/page_1" });
  });

  it("creates a database item using a custom title property", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "row_1", url: "https://notion.so/row_1" }), { status: 200 }));
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("n", "action.notion", {
          credentialId: "c1",
          action: "create_page",
          parentType: "database",
          parentId: "db_1",
          title: "New row",
          titleProperty: "Task name",
        }),
      ],
      edges: [edge("e1", "t", "n")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "notion_token", data: { token: "secret_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      parent: { database_id: "db_1" },
      properties: { "Task name": { title: [{ text: { content: "New row" } }] } },
    });
    expect(outputOf(result, "n")).toMatchObject({ id: "row_1" });
  });

  it("appends a text block to an existing page via PATCH", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const def: WorkflowDefinition = {
      nodes: [
        node("t", "trigger.manual"),
        node("n", "action.notion", { credentialId: "c1", action: "append_text", pageId: "page_1", text: "Update: {{trigger.status}}" }),
      ],
      edges: [edge("e1", "t", "n")],
    };
    const result = await run(def, {
      payload: { status: "done" },
      credentials: { c1: { type: "notion_token", data: { token: "secret_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/blocks/page_1/children");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({
      children: [{ paragraph: { rich_text: [{ text: { content: "Update: done" } }] } }],
    });
    expect(outputOf(result, "n")).toEqual({ action: "append_text", id: "page_1", url: null });
  });

  it("fails clearly when the wrong credential type is referenced", async () => {
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("n", "action.notion", { credentialId: "c1", parentId: "p1", title: "x" })],
      edges: [edge("e1", "t", "n")],
    };
    const result = await run(def, { credentials: { c1: { type: "github_token", data: { token: "x" } } } });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "n")).toMatch(/needs a notion_token/);
  });

  it("rejects append_text with no pageId before calling fetch", async () => {
    const fetchMock = vi.fn();
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("n", "action.notion", { credentialId: "c1", action: "append_text", text: "hi" })],
      edges: [edge("e1", "t", "n")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "notion_token", data: { token: "secret_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "n")).toMatch(/requires a 'pageId'/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Notion's error message on a non-2xx response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ object: "error", message: "Could not find page" }), { status: 404 }));
    const def: WorkflowDefinition = {
      nodes: [node("t", "trigger.manual"), node("n", "action.notion", { credentialId: "c1", parentId: "p1", title: "x" })],
      edges: [edge("e1", "t", "n")],
    };
    const result = await run(def, {
      credentials: { c1: { type: "notion_token", data: { token: "secret_abc" } } },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("failed");
    expect(errorOf(result, "n")).toMatch(/404.*Could not find page/);
  });
});
