import { describe, expect, it } from "vitest";
import { CycleError, topologicalSort } from "../topologicalSort";
import type { WorkflowEdge, WorkflowNode } from "../types";

function node(id: string, type = "action.http"): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config: {} };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target };
}

/** A valid topological order must place every edge's source before its target. */
function expectRespectsEdges(order: string[], edges: WorkflowEdge[]): void {
  for (const e of edges) {
    expect(order.indexOf(e.source)).toBeLessThan(order.indexOf(e.target));
  }
}

describe("topologicalSort", () => {
  it("returns an empty order for an empty graph", () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it("returns the single node for a graph with no edges", () => {
    expect(topologicalSort([node("a")], [])).toEqual(["a"]);
  });

  it("orders a linear chain correctly", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    const order = topologicalSort(nodes, edges);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("orders a diamond graph correctly", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("e1", "a", "b"), edge("e2", "a", "c"), edge("e3", "b", "d"), edge("e4", "c", "d")];
    const order = topologicalSort(nodes, edges);
    expect(order).toHaveLength(4);
    expectRespectsEdges(order, edges);
    expect(order[0]).toBe("a");
    expect(order[3]).toBe("d");
  });

  it("includes disconnected nodes in the order", () => {
    const nodes = [node("a"), node("b"), node("isolated")];
    const edges = [edge("e1", "a", "b")];
    const order = topologicalSort(nodes, edges);
    expect(order).toHaveLength(3);
    expect(order).toContain("isolated");
    expectRespectsEdges(order, edges);
  });

  it("ignores edges that reference a node not present in the node list", () => {
    const nodes = [node("a"), node("b")];
    const edges = [edge("e1", "a", "ghost")];
    const order = topologicalSort(nodes, edges);
    expect(order).toHaveLength(2);
    expect(new Set(order)).toEqual(new Set(["a", "b"]));
  });

  it("throws CycleError for a self-loop", () => {
    const nodes = [node("a")];
    const edges = [edge("e1", "a", "a")];
    expect(() => topologicalSort(nodes, edges)).toThrow(CycleError);
  });

  it("throws CycleError for a two-node cycle", () => {
    const nodes = [node("a"), node("b")];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "a")];
    try {
      topologicalSort(nodes, edges);
      expect.fail("expected topologicalSort to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect((error as CycleError).remainingNodeIds.sort()).toEqual(["a", "b"]);
    }
  });

  it("throws CycleError for a longer cycle, excluding acyclic nodes from the report", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    // a -> b -> c -> a is a cycle; d feeds into it but is itself resolvable, so it should
    // be processed and excluded from the reported remaining (cyclic) node ids.
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a"), edge("e4", "d", "a")];
    try {
      topologicalSort(nodes, edges);
      expect.fail("expected topologicalSort to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect((error as CycleError).remainingNodeIds.sort()).toEqual(["a", "b", "c"]);
    }
  });
});
