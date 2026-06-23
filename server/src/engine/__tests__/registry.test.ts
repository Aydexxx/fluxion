import { describe, expect, it } from "vitest";
import { NodeExecutorRegistry, createDefaultRegistry } from "../registry";
import type { NodeExecutor } from "../types";

describe("NodeExecutorRegistry", () => {
  it("ships with all built-in executors (incl. every trigger type)", () => {
    const registry = createDefaultRegistry();
    expect(registry.types().sort()).toEqual(
      [
        "action.http",
        "action.transform",
        "ai.llm",
        "logic.condition",
        "output.response",
        "trigger.manual",
        "trigger.schedule",
        "trigger.webhook",
      ].sort(),
    );
  });

  it("registers a brand-new node type with a single call (core extensibility goal)", async () => {
    const customExecutor: NodeExecutor = {
      type: "custom.echo",
      async execute(node) {
        return { echoed: node.config.value };
      },
    };

    const registry = createDefaultRegistry().register(customExecutor);

    expect(registry.has("custom.echo")).toBe(true);
    const executor = registry.get("custom.echo")!;
    const result = await executor.execute(
      { id: "x", type: "custom.echo", position: { x: 0, y: 0 }, config: { value: 42 } },
      { trigger: null, sources: {} },
      {} as never,
    );
    expect(result).toEqual({ echoed: 42 });
  });

  it("returns undefined for an unknown type", () => {
    expect(new NodeExecutorRegistry().get("nope")).toBeUndefined();
  });
});
