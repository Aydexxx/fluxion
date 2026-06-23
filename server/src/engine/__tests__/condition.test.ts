import { describe, expect, it } from "vitest";
import { conditionExecutor, type ConditionOutput } from "../executors/logicCondition";
import type { ExecutionContext, NodeInput } from "../types";
import type { WorkflowNode } from "../../dag/types";

const input: NodeInput = { trigger: null, sources: {} };
const context = {} as ExecutionContext;

function node(expression: string): WorkflowNode {
  return { id: "c", type: "logic.condition", position: { x: 0, y: 0 }, config: { expression } };
}

async function evalExpr(expression: string): Promise<ConditionOutput> {
  return conditionExecutor.execute(node(expression), input, context) as Promise<ConditionOutput>;
}

describe("conditionExecutor", () => {
  it("evaluates numeric equality and emits a true branch", async () => {
    expect(await evalExpr("200 == 200")).toEqual({ result: true, branch: "true" });
  });

  it("emits a false branch when the comparison fails", async () => {
    expect(await evalExpr("200 == 404")).toEqual({ result: false, branch: "false" });
  });

  it("supports numeric ordering comparisons", async () => {
    expect((await evalExpr("5 > 3")).result).toBe(true);
    expect((await evalExpr("5 <= 3")).result).toBe(false);
    expect((await evalExpr("10 >= 10")).result).toBe(true);
  });

  it("compares strings (already template-resolved) with == and !=", async () => {
    expect((await evalExpr("active == active")).result).toBe(true);
    expect((await evalExpr("active != closed")).result).toBe(true);
  });

  it("handles quoted string operands", async () => {
    expect((await evalExpr('"yes" == yes')).result).toBe(true);
  });

  it("evaluates a bare value by truthiness", async () => {
    expect((await evalExpr("true")).result).toBe(true);
    expect((await evalExpr("false")).result).toBe(false);
    expect((await evalExpr("0")).result).toBe(false);
    expect((await evalExpr("")).result).toBe(false);
    expect((await evalExpr("anything")).result).toBe(true);
  });
});
