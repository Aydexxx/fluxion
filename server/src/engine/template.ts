/**
 * Minimal `{{path.to.value}}` template resolver for node configs.
 *
 * Data passing between nodes works by referencing an upstream node's output in
 * a config string, e.g. `{{n2.body.id}}` or `{{trigger.email}}`. The scope is a
 * flat map of `nodeId -> output` plus a `trigger` key for the run payload.
 *
 * Two resolution modes, decided by the shape of the string:
 *  - "exact" — the whole string is a single `{{...}}` token: the resolved value
 *    is returned with its original type preserved (object, number, boolean…),
 *    so `{{n2}}` can forward a whole object, not its `[object Object]` string.
 *  - "interpolated" — `{{...}}` appears inside surrounding text: every token is
 *    stringified and spliced in, yielding a string.
 *
 * Unresolved paths become `undefined` in exact mode and `""` when interpolated.
 */

export type TemplateScope = Record<string, unknown>;

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;
const EXACT_TOKEN = /^\{\{\s*([^}]+?)\s*\}\}$/;

/** Walks a dotted path (e.g. `n2.body.id`) through the scope, returning `undefined` if any hop is missing. */
function lookup(scope: TemplateScope, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = scope;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Resolves templates inside a single string. */
function resolveString(input: string, scope: TemplateScope): unknown {
  const exact = input.match(EXACT_TOKEN);
  if (exact) {
    return lookup(scope, exact[1]);
  }
  return input.replace(TOKEN, (_match, path: string) => stringify(lookup(scope, path.trim())));
}

/**
 * Deep-resolves every string in `value` (arrays and plain objects are walked
 * recursively). Non-string leaves are returned untouched. Used to resolve a
 * node's whole `config` object against the accumulated run scope.
 */
export function resolveTemplates<T>(value: T, scope: TemplateScope): T {
  if (typeof value === "string") {
    return resolveString(value, scope) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, scope)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = resolveTemplates(val, scope);
    }
    return out as T;
  }
  return value;
}
