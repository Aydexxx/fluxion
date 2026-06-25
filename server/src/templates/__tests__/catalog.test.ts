import { describe, expect, it } from "vitest";
import { TEMPLATES, findTemplate, templateNodeTypes } from "../catalog";
import { validateDefinition } from "../../dag/validateDefinition";
import { isTriggerNodeType } from "../../dag/nodeTypes";

describe("template catalog", () => {
  it("exposes at least the four seeded templates with unique ids", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(4);
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))("%s", (_id, template) => {
    it("has a valid, error-free definition", () => {
      const result = validateDefinition(template.definition);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("is fully connected (no disconnected-node warnings)", () => {
      // A first-run-quality template should have every node wired into the graph.
      const result = validateDefinition(template.definition);
      expect(result.warnings).toEqual([]);
    });

    it("has exactly one trigger node", () => {
      const triggers = template.definition.nodes.filter((n) => isTriggerNodeType(n.type));
      expect(triggers).toHaveLength(1);
    });

    it("gives every node a display title", () => {
      for (const node of template.definition.nodes) {
        expect(node.config.__title, `node ${node.id} is missing a title`).toBeTypeOf("string");
      }
    });

    it("reports its node types in first-appearance order", () => {
      const types = templateNodeTypes(template);
      expect(types[0]).toBe(template.definition.nodes[0]?.type);
      expect(new Set(types).size).toBe(types.length);
    });
  });

  it("looks up a template by id and misses cleanly", () => {
    expect(findTemplate(TEMPLATES[0].id)?.id).toBe(TEMPLATES[0].id);
    expect(findTemplate("nope")).toBeUndefined();
  });
});
