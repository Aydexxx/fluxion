import type { NodeExecutor } from "../types";

interface KeyValueMapping {
  key?: unknown;
  value?: unknown;
}

interface TransformConfig {
  /**
   * Field mappings. Accepts either the editor's key/value row form
   * (`[{ key, value }]`) or a plain record (`{ key: value }`). Values are
   * template-resolved before this runs.
   */
  mappings?: Record<string, unknown> | KeyValueMapping[];
}

/**
 * Shapes data: produces an object from the node's `mappings` config. Because
 * config strings are template-resolved before execution, a mapping value like
 * `"{{n1.first}} {{n1.last}}"` arrives here already filled in — this executor
 * just assembles the resolved values into the output object.
 */
export const transformExecutor: NodeExecutor = {
  type: "action.transform",
  async execute(node): Promise<Record<string, unknown>> {
    const mappings = (node.config as TransformConfig).mappings;

    if (Array.isArray(mappings)) {
      const out: Record<string, unknown> = {};
      for (const { key, value } of mappings) {
        if (typeof key === "string" && key.trim() !== "") out[key] = value;
      }
      return out;
    }

    return { ...(mappings ?? {}) };
  },
};
