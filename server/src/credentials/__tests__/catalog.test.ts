import { describe, expect, it } from "vitest";
import { CREDENTIAL_TYPES, getCredentialTypeSpec, isKnownCredentialType } from "../catalog";

describe("getCredentialTypeSpec", () => {
  it("returns the spec for every known type", () => {
    for (const type of Object.keys(CREDENTIAL_TYPES)) {
      expect(getCredentialTypeSpec(type)?.type).toBe(type);
    }
  });

  it("returns undefined for an unknown type", () => {
    expect(getCredentialTypeSpec("mystery")).toBeUndefined();
  });
});

describe("isKnownCredentialType", () => {
  it("is true for catalog entries and false otherwise", () => {
    expect(isKnownCredentialType("smtp")).toBe(true);
    expect(isKnownCredentialType("database")).toBe(true);
    expect(isKnownCredentialType("mystery")).toBe(false);
    expect(isKnownCredentialType("")).toBe(false);
  });
});

describe("credential field specs", () => {
  it("every previewKey, when set, names one of the type's own fields", () => {
    for (const spec of Object.values(CREDENTIAL_TYPES)) {
      if (spec.previewKey === null) continue;
      expect(spec.fields.some((f) => f.key === spec.previewKey)).toBe(true);
    }
  });

  it("every type has at least one field", () => {
    for (const spec of Object.values(CREDENTIAL_TYPES)) {
      expect(spec.fields.length).toBeGreaterThan(0);
    }
  });
});
