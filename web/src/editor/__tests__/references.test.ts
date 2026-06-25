import { describe, expect, it } from "vitest";
import {
  hasReference,
  insertReference,
  parseSegments,
  previewExpression,
  referencePaths,
  refToken,
  resolvePath,
} from "../references";

describe("references — insertion", () => {
  it("inserts a reference token at the caret, returning the post-token cursor", () => {
    const { value, cursor } = insertReference("Hello ", 6, 6, "input.name");
    expect(value).toBe("Hello {{ input.name }}");
    expect(cursor).toBe(value.length);
  });

  it("replaces the current selection with the token", () => {
    const { value } = insertReference("Hello WORLD!", 6, 11, "input.name");
    expect(value).toBe("Hello {{ input.name }}!");
  });

  it("adds a separating space when inserting directly after a word character", () => {
    const { value } = insertReference("id:", 3, 3, "trigger.id");
    expect(value).toBe("id: {{ trigger.id }}");
  });

  it("does not add a space after whitespace", () => {
    const { value } = insertReference("id: ", 4, 4, "trigger.id");
    expect(value).toBe("id: {{ trigger.id }}");
  });

  it("trims and wraps a path with refToken", () => {
    expect(refToken("  a.b  ")).toBe("{{ a.b }}");
  });
});

describe("references — parsing", () => {
  it("splits a value into text and reference segments in order", () => {
    const segs = parseSegments("Hi {{ input.name }}, code {{ trigger.code }}!");
    expect(segs).toEqual([
      { type: "text", text: "Hi " },
      { type: "ref", text: "{{ input.name }}", path: "input.name" },
      { type: "text", text: ", code " },
      { type: "ref", text: "{{ trigger.code }}", path: "trigger.code" },
      { type: "text", text: "!" },
    ]);
  });

  it("lists every referenced path", () => {
    expect(referencePaths("{{ a }}-{{ b.c }}-{{ a }}")).toEqual(["a", "b.c", "a"]);
  });

  it("detects whether a value contains a reference", () => {
    expect(hasReference("plain text")).toBe(false);
    expect(hasReference("has {{ ref }}")).toBe(true);
  });
});

describe("references — resolution against sample data", () => {
  const scope = {
    trigger: { id: 42 },
    input: { name: "Ada", tags: ["x", "y"] },
    node_x: { body: { title: "Hello", count: 3 } },
  };

  it("resolves a dotted path, including array indices", () => {
    expect(resolvePath(scope, "input.name")).toBe("Ada");
    expect(resolvePath(scope, "input.tags.1")).toBe("y");
    expect(resolvePath(scope, "node_x.body.title")).toBe("Hello");
  });

  it("returns undefined for a missing path", () => {
    expect(resolvePath(scope, "input.missing")).toBeUndefined();
    expect(resolvePath(scope, "nope.deep.path")).toBeUndefined();
  });

  it("interpolates tokens inside surrounding text", () => {
    const preview = previewExpression("Hi {{ input.name }} (#{{ trigger.id }})", scope);
    expect(preview.text).toBe("Hi Ada (#42)");
    expect(preview.hasMissing).toBe(false);
    expect(preview.hasReference).toBe(true);
  });

  it("preserves type for a single exact token (object shown as JSON)", () => {
    const preview = previewExpression("{{ node_x.body }}", scope);
    expect(preview.text).toBe('{"title":"Hello","count":3}');
  });

  it("flags previews that reference missing sample data", () => {
    const preview = previewExpression("Hello {{ input.unknown }}", scope);
    expect(preview.hasMissing).toBe(true);
  });

  it("treats a value with no references as a plain literal", () => {
    const preview = previewExpression("no refs here", scope);
    expect(preview).toEqual({ text: "no refs here", hasMissing: false, hasReference: false });
  });
});
