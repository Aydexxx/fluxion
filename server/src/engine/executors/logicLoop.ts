import type { NodeExecutor } from "../types";
import { lookupPath, readArrayInput } from "./collections";

interface FieldProjection {
  /** Output key to write. */
  as?: string;
  /** Dotted path read from each item (empty = the whole item). */
  path?: string;
}

interface LoopConfig {
  items?: unknown;
  /** Optional per-item projection; when empty, items pass through unchanged. */
  fields?: FieldProjection[];
}

export interface LoopOutput {
  items: unknown[];
  count: number;
  isEmpty: boolean;
}

/**
 * Iterates over an array input, emitting one result per item so downstream
 * nodes process the collection item-by-item. With no `fields`, items pass
 * through unchanged; with `fields`, each item is projected into a new object by
 * reading dotted paths (`{ as: "email", path: "user.email" }`). Per-item paths
 * are plain field references evaluated here (not `{{templates}}`), so they
 * survive the orchestrator's up-front config resolution untouched.
 */
export const loopExecutor: NodeExecutor = {
  type: "logic.loop",
  async execute(node, input): Promise<LoopOutput> {
    const config = node.config as LoopConfig;
    const source = readArrayInput(config.items, input);
    const fields = Array.isArray(config.fields) ? config.fields.filter((f) => typeof f?.as === "string" && f.as) : [];

    const items = fields.length === 0 ? source : source.map((item) => project(item, fields));
    return { items, count: items.length, isEmpty: items.length === 0 };
  },
};

function project(item: unknown, fields: FieldProjection[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.as as string] = lookupPath(item, field.path ?? "");
  }
  return out;
}
