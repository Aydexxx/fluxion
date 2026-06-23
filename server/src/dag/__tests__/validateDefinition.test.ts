import { describe, expect, it } from "vitest";
import { validateDefinition } from "../validateDefinition";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../types";

function node(id: string, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config: {}, ...overrides };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target };
}

function definition(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition {
  return { nodes, edges };
}

describe("validateDefinition", () => {
  it("accepts a completely empty definition (the freshly-created placeholder state)", () => {
    const result = validateDefinition(definition([], []));
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("accepts a valid, fully-connected DAG with exactly one trigger", () => {
    const def = definition(
      [node("trigger", "trigger.manual"), node("action", "action.http"), node("output", "output.response")],
      [edge("e1", "trigger", "action"), edge("e2", "action", "output")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects a cyclic graph", () => {
    const def = definition(
      [node("trigger", "trigger.manual"), node("a", "action.http"), node("b", "action.transform")],
      [edge("e1", "trigger", "a"), edge("e2", "a", "b"), edge("e3", "b", "a")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((message) => /cycle/i.test(message))).toBe(true);
  });

  it("rejects an edge that references a node that doesn't exist", () => {
    const def = definition(
      [node("trigger", "trigger.manual"), node("a", "action.http")],
      [edge("e1", "trigger", "a"), edge("e2", "a", "ghost")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Edge "e2" references unknown target node "ghost"');
  });

  it("rejects a definition with zero trigger nodes", () => {
    const def = definition(
      [node("a", "action.http"), node("b", "output.response")],
      [edge("e1", "a", "b")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow must have exactly one trigger node, found 0");
  });

  it("rejects a definition with more than one trigger node", () => {
    const def = definition(
      [node("t1", "trigger.manual"), node("t2", "trigger.webhook"), node("a", "action.http")],
      [edge("e1", "t1", "a"), edge("e2", "t2", "a")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Workflow must have exactly one trigger node, found 2");
  });

  it("warns, but does not fail, on a disconnected action node", () => {
    const def = definition(
      [node("trigger", "trigger.manual"), node("a", "action.http"), node("orphan", "action.transform")],
      [edge("e1", "trigger", "a")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('Node "orphan" (action.transform) is disconnected from the workflow graph');
  });

  it("does not warn about a trigger node having no incoming edges", () => {
    const def = definition([node("trigger", "trigger.manual"), node("a", "action.http")], [edge("e1", "trigger", "a")]);
    const result = validateDefinition(def);
    expect(result.warnings).toEqual([]);
  });

  it("warns about an unrecognized node type without failing validation", () => {
    const def = definition(
      [node("trigger", "trigger.manual"), node("a", "mystery.type")],
      [edge("e1", "trigger", "a")],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Node "a" has an unrecognized type "mystery.type"');
  });

  it("rejects duplicate node ids", () => {
    const def = definition(
      [node("trigger", "trigger.manual"), node("trigger", "trigger.webhook")],
      [],
    );
    const result = validateDefinition(def);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate node id: "trigger"');
  });
});
