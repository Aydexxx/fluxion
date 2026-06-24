import type { NodeInput } from "../types";

/**
 * Resolves the array a loop/filter node operates on. Preference order:
 *  1. an explicit `config.items` (typically a template like `{{input.users}}`
 *     that resolved to an array before the executor ran);
 *  2. the single upstream node's output, when it is itself an array;
 *  3. that output's `.items` field, when it wraps the array (e.g. a prior loop).
 * Returns `[]` when nothing array-shaped is found, so an empty input is a
 * no-op rather than an error.
 */
export function readArrayInput(items: unknown, input: NodeInput): unknown[] {
  if (Array.isArray(items)) return items;

  const sources = Object.values(input.sources);
  if (sources.length === 1) {
    const only = sources[0];
    if (Array.isArray(only)) return only;
    if (only && typeof only === "object" && Array.isArray((only as { items?: unknown }).items)) {
      return (only as { items: unknown[] }).items;
    }
  }
  return [];
}

/** Reads a dotted path (e.g. `user.email`) out of an item; an empty path returns the item itself. */
export function lookupPath(item: unknown, path: string): unknown {
  if (path === "") return item;
  let current = item;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
