import { describe, expect, it } from "vitest";
import { resolveTemplates } from "../template";

const scope = {
  trigger: { email: "ada@example.com", count: 3 },
  n2: { status: 200, body: { id: "abc", nested: { ok: true } } },
};

describe("resolveTemplates", () => {
  it("interpolates a token inside surrounding text as a string", () => {
    expect(resolveTemplates("Hello {{trigger.email}}!", scope)).toBe("Hello ada@example.com!");
  });

  it("preserves the original type when the whole string is a single token", () => {
    expect(resolveTemplates("{{n2.status}}", scope)).toBe(200);
    expect(resolveTemplates("{{n2.body}}", scope)).toEqual({ id: "abc", nested: { ok: true } });
    expect(resolveTemplates("{{n2.body.nested.ok}}", scope)).toBe(true);
  });

  it("walks deep dotted paths", () => {
    expect(resolveTemplates("{{n2.body.id}}", scope)).toBe("abc");
  });

  it("resolves missing paths to empty string when interpolated, undefined when exact", () => {
    expect(resolveTemplates("x={{n2.missing}}", scope)).toBe("x=");
    expect(resolveTemplates("{{n9.nope}}", scope)).toBeUndefined();
  });

  it("stringifies objects when interpolated", () => {
    expect(resolveTemplates("body={{n2.body}}", scope)).toBe('body={"id":"abc","nested":{"ok":true}}');
  });

  it("deep-resolves every string in a config object, leaving non-strings untouched", () => {
    const config = {
      url: "https://api.test/{{n2.body.id}}",
      retries: 5,
      // exact single-token -> type preserved (number); interpolated -> string
      count: "{{trigger.count}}",
      headers: { "X-Count": "count={{trigger.count}}" },
      list: ["{{trigger.email}}", 42],
    };
    expect(resolveTemplates(config, scope)).toEqual({
      url: "https://api.test/abc",
      retries: 5,
      count: 3,
      headers: { "X-Count": "count=3" },
      list: ["ada@example.com", 42],
    });
  });

  it("supports multiple tokens in one string", () => {
    expect(resolveTemplates("{{trigger.email}} ({{n2.status}})", scope)).toBe("ada@example.com (200)");
  });
});
