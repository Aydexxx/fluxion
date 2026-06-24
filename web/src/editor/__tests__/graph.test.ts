import { describe, expect, it } from "vitest";
import { createNode, definitionToFlow, flowToDefinition, newEdgeId } from "../graph";
import type { WorkflowDefinition } from "../../lib/types";

describe("createNode", () => {
  it("seeds a fresh node from the type's catalog spec", () => {
    const node = createNode("trigger.manual", { x: 10, y: 20 });
    expect(node.type).toBe("flux");
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data.nodeType).toBe("trigger.manual");
    expect(node.id).toMatch(/^node_/);
  });

  it("gives each node a unique id", () => {
    const a = createNode("trigger.manual", { x: 0, y: 0 });
    const b = createNode("trigger.manual", { x: 0, y: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it("deep-clones the default config so nodes don't share state", () => {
    const a = createNode("logic.filter", { x: 0, y: 0 });
    const b = createNode("logic.filter", { x: 0, y: 0 });
    (a.data.config as Record<string, unknown>).mutated = true;
    expect(b.data.config).not.toHaveProperty("mutated");
  });
});

describe("newEdgeId", () => {
  it("produces unique, prefixed ids", () => {
    const a = newEdgeId();
    const b = newEdgeId();
    expect(a).toMatch(/^edge_/);
    expect(a).not.toBe(b);
  });
});

describe("definitionToFlow / flowToDefinition", () => {
  const definition: WorkflowDefinition = {
    nodes: [
      { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: { __title: "Start" } },
      { id: "o", type: "output.response", position: { x: 200, y: 50 }, config: { body: "hi", __title: "Done" } },
    ],
    edges: [{ id: "e1", source: "t", target: "o", sourceHandle: "out" }],
  };

  it("folds the reserved __title key out of config and into data.title", () => {
    const { nodes } = definitionToFlow(definition);
    const t = nodes.find((n) => n.id === "t")!;
    expect(t.data.title).toBe("Start");
    expect(t.data.config).not.toHaveProperty("__title");
  });

  it("falls back to the catalog's default title when none was saved", () => {
    const def: WorkflowDefinition = {
      nodes: [{ id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    const { nodes } = definitionToFlow(def);
    expect(nodes[0].data.title).toBe("Manual trigger");
  });

  it("carries edge handles through, defaulting missing ones to null", () => {
    const { edges } = definitionToFlow(definition);
    expect(edges[0]).toMatchObject({ id: "e1", source: "t", target: "o", sourceHandle: "out", targetHandle: null });
  });

  it("handles an undefined definition as an empty graph", () => {
    expect(definitionToFlow(undefined)).toEqual({ nodes: [], edges: [] });
  });

  it("round-trips through flowToDefinition, folding the title back into config", () => {
    const { nodes, edges } = definitionToFlow(definition);
    const roundTripped = flowToDefinition(nodes, edges);

    expect(roundTripped.nodes).toEqual([
      { id: "t", type: "trigger.manual", position: { x: 0, y: 0 }, config: { __title: "Start" } },
      { id: "o", type: "output.response", position: { x: 200, y: 50 }, config: { body: "hi", __title: "Done" } },
    ]);
    expect(roundTripped.edges).toEqual([{ id: "e1", source: "t", target: "o", sourceHandle: "out" }]);
  });

  it("rounds fractional positions to whole pixels", () => {
    const { nodes } = definitionToFlow(definition);
    nodes[0].position = { x: 10.6, y: 9.4 };
    const result = flowToDefinition(nodes, []);
    expect(result.nodes[0].position).toEqual({ x: 11, y: 9 });
  });

  it("omits handle keys entirely when an edge has none", () => {
    const { nodes } = definitionToFlow(definition);
    const plainEdge = { id: "e2", source: "t", target: "o", sourceHandle: null, targetHandle: null };
    const result = flowToDefinition(nodes, [plainEdge as never]);
    expect(result.edges[0]).toEqual({ id: "e2", source: "t", target: "o" });
  });
});
