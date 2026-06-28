import { describe, expect, it } from "vitest";
import { runWorkflow } from "../runWorkflow";
import { runSingleNode } from "../runSingleNode";
import { createDefaultRegistry } from "../registry";
import { InMemoryRunRecorder, type RunRecord } from "../persistence";
import type { LlmSettings, NodeExecutor, VariableResolver } from "../types";
import type { WorkflowDefinition } from "../../dag/types";

/**
 * Engine resolution of `{{ vars.* }}` / `{{ secrets.* }}` in node configs. The
 * VariableResolver is the execution-time boundary — in production it decrypts
 * secrets on the worker; here a stub stands in for that decrypt pass, proving the
 * resolved (plaintext) values reach the executor's config and nowhere else.
 */

const llm: LlmSettings = {
  provider: "none",
  ollamaBaseUrl: "",
  ollamaModel: "",
  openaiBaseUrl: "",
  openaiModel: "",
};

/** Captures the exact (already template-resolved) config each execution receives. */
function captureRegistry() {
  const seen: Record<string, unknown>[] = [];
  const capture: NodeExecutor = {
    type: "test.capture",
    async execute(node) {
      seen.push(node.config);
      return node.config;
    },
  };
  return { registry: createDefaultRegistry().register(capture), seen };
}

const resolver = (vars: Record<string, string>, secrets: Record<string, string>): VariableResolver => ({
  async resolve() {
    return { vars, secrets };
  },
});

const definition: WorkflowDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    {
      id: "c",
      type: "test.capture",
      position: { x: 100, y: 0 },
      config: { url: "{{ vars.BASE_URL }}/v1/users", auth: "Bearer {{ secrets.API_TOKEN }}", token: "{{ secrets.API_TOKEN }}" },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "c" }],
};

async function run(variables?: VariableResolver): Promise<{ result: RunRecord; seen: Record<string, unknown>[] }> {
  const { registry, seen } = captureRegistry();
  const recorder = new InMemoryRunRecorder();
  const runId = await recorder.enqueueRun({ workflowId: "wf", trigger: "manual", payload: null });
  const result = await runWorkflow({
    runId,
    workflowId: "wf",
    workspaceId: "ws",
    definition,
    trigger: { type: "manual", payload: null },
    registry,
    recorder,
    llm,
    variables,
  });
  return { result, seen };
}

describe("variable/secret resolution in node configs (runWorkflow)", () => {
  it("resolves {{ vars.* }} and {{ secrets.* }} into the executor's config", async () => {
    const { result, seen } = await run(
      resolver({ BASE_URL: "https://api.example.com" }, { API_TOKEN: "sk-secret-9999" }),
    );

    expect(result.status).toBe("success");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      url: "https://api.example.com/v1/users",
      auth: "Bearer sk-secret-9999",
      token: "sk-secret-9999",
    });
  });

  it("resolves a whole-string secret token to the raw value (type preserved)", async () => {
    const { seen } = await run(resolver({}, { API_TOKEN: "raw-token" }));
    // `token` is an exact single-token string, so it forwards the resolved value verbatim.
    expect(seen[0].token).toBe("raw-token");
  });

  it("gracefully yields empty/undefined when no resolver is wired", async () => {
    const { result, seen } = await run(); // no variables resolver
    expect(result.status).toBe("success");
    // Interpolated tokens stringify a missing value to ""; exact tokens to undefined.
    expect(seen[0].url).toBe("/v1/users");
    expect(seen[0].token).toBeUndefined();
  });
});

describe("variable/secret resolution (runSingleNode)", () => {
  it("resolves vars + secrets when testing a node in isolation", async () => {
    const { registry } = captureRegistry();
    const result = await runSingleNode({
      workspaceId: "ws",
      definition,
      nodeId: "c",
      registry,
      llm,
      variables: resolver({ BASE_URL: "https://test.local" }, { API_TOKEN: "tok-123" }),
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({
      url: "https://test.local/v1/users",
      auth: "Bearer tok-123",
      token: "tok-123",
    });
  });
});
