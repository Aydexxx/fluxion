/**
 * Client-side mirror of the engine's `{{ path }}` template language, plus the
 * extra affordances the visual editor needs: inserting reference tokens at a
 * cursor, splitting a value into text/chip segments for highlighted rendering,
 * and previewing the resolved value against sample data.
 *
 * Resolution rules match the backend (see server `engine/template.ts`):
 *  - a value that is a single `{{ ... }}` token resolves to the referenced value
 *    with its type preserved (object/number/boolean), and
 *  - tokens embedded in surrounding text are stringified and spliced in.
 */

export type Scope = Record<string, unknown>;

const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;
const EXACT_TOKEN = /^\{\{\s*([^}]+?)\s*\}\}$/;

/** Walks a dotted path (e.g. `node_x.body.title`) through `scope`. */
export function lookup(scope: Scope, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = scope;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment.trim()];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A reference token wrapping a dotted path, e.g. `{{ node_x.body }}`. */
export function refToken(path: string): string {
  return `{{ ${path.trim()} }}`;
}

/** Every reference path used in `value`, in order of appearance (may repeat). */
export function referencePaths(value: string): string[] {
  const paths: string[] = [];
  for (const match of value.matchAll(TOKEN)) paths.push(match[1].trim());
  return paths;
}

export type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; text: string; path: string };

/**
 * Splits `value` into literal text and reference segments, so an overlay can
 * render references as chips while leaving surrounding text untouched.
 */
export function parseSegments(value: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ type: "text", text: value.slice(lastIndex, start) });
    segments.push({ type: "ref", text: match[0], path: match[1].trim() });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < value.length) segments.push({ type: "text", text: value.slice(lastIndex) });
  return segments;
}

/**
 * Inserts a reference for `path` into `value`, replacing the `[start, end)`
 * selection. Returns the new value and the caret position just after the token,
 * so the caller can restore the cursor. A single space is added before the token
 * when it would otherwise butt directly against a preceding word character.
 */
export function insertReference(
  value: string,
  start: number,
  end: number,
  path: string,
): { value: string; cursor: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needsSpace = before.length > 0 && /\S$/.test(before) && !/\s$/.test(before);
  const token = (needsSpace ? " " : "") + refToken(path);
  return { value: before + token + after, cursor: before.length + token.length };
}

export interface ResolvedPreview {
  /** The resolved value rendered for display. */
  text: string;
  /** True when at least one referenced path resolved to `undefined`. */
  hasMissing: boolean;
  /** True when `value` actually contains a reference token. */
  hasReference: boolean;
}

/** Resolves a single path against `scope` for hover/inline previews. */
export function resolvePath(scope: Scope, path: string): unknown {
  return lookup(scope, path);
}

/**
 * Resolves all tokens in `value` against `scope` for a live preview. Exact
 * single-token values keep their resolved type (shown as JSON); interpolated
 * values resolve to a string.
 */
export function previewExpression(value: string, scope: Scope): ResolvedPreview {
  const paths = referencePaths(value);
  if (paths.length === 0) return { text: value, hasMissing: false, hasReference: false };

  const hasMissing = paths.some((path) => lookup(scope, path) === undefined);

  const exact = value.match(EXACT_TOKEN);
  if (exact) {
    const resolved = lookup(scope, exact[1].trim());
    return { text: formatValue(resolved), hasMissing, hasReference: true };
  }
  const text = value.replace(TOKEN, (_m, path: string) => stringify(lookup(scope, path.trim())));
  return { text, hasMissing, hasReference: true };
}

/** Human-readable rendering of an arbitrary sample value for previews/tooltips. */
export function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** True when `value` contains at least one reference token. */
export function hasReference(value: string): boolean {
  return /\{\{\s*[^}]+?\s*\}\}/.test(value);
}
