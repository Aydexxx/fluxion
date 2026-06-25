import { describe, expect, it } from "vitest";
import { diffDefinitions, definitionsEqual } from "../diffDefinition";
import type { WorkflowDefinition } from "../types";

const base: WorkflowDefinition = {
  nodes: [
    { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
    { id: "a", type: "action.http", position: { x: 100, y: 0 }, config: { url: "https://a.example" } },
  ],
  edges: [{ id: "e1", source: "t", target: "a" }],
};

describe("diffDefinitions", () => {
  it("reports no changes between identical definitions", () => {
    const diff = diffDefinitions(base, structuredClone(base));
    expect(diff.identical).toBe(true);
    expect(definitionsEqual(base, structuredClone(base))).toBe(true);
    expect(diff).toMatchObject({ addedNodes: [], removedNodes: [], changedNodes: [], edgesAdded: 0, edgesRemoved: 0 });
  });

  it("detects an added node and its new edge", () => {
    const next: WorkflowDefinition = {
      nodes: [...base.nodes, { id: "b", type: "output.response", position: { x: 200, y: 0 }, config: {} }],
      edges: [...base.edges, { id: "e2", source: "a", target: "b" }],
    };
    const diff = diffDefinitions(base, next);
    expect(diff.identical).toBe(false);
    expect(diff.addedNodes).toEqual([{ id: "b", type: "output.response" }]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.edgesAdded).toBe(1);
    expect(diff.edgesRemoved).toBe(0);
  });

  it("detects a removed node and edge", () => {
    const next: WorkflowDefinition = { nodes: [base.nodes[0]], edges: [] };
    const diff = diffDefinitions(base, next);
    expect(diff.removedNodes).toEqual([{ id: "a", type: "action.http" }]);
    expect(diff.edgesRemoved).toBe(1);
  });

  it("classifies config, type, and position changes", () => {
    const next: WorkflowDefinition = {
      nodes: [
        { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} },
        // url changed (config), moved (position)
        { id: "a", type: "action.http", position: { x: 140, y: 0 }, config: { url: "https://b.example" } },
      ],
      edges: base.edges,
    };
    const diff = diffDefinitions(base, next);
    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0].id).toBe("a");
    expect(diff.changedNodes[0].changes.sort()).toEqual(["config", "position"]);
  });

  it("ignores edge id churn when endpoints are unchanged", () => {
    const next: WorkflowDefinition = { ...base, edges: [{ id: "different-id", source: "t", target: "a" }] };
    const diff = diffDefinitions(base, next);
    expect(diff.edgesAdded).toBe(0);
    expect(diff.edgesRemoved).toBe(0);
    expect(diff.identical).toBe(true);
  });
});
