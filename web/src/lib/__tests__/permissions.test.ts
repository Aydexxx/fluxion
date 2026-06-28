import { describe, expect, it } from "vitest";
import {
  canDeleteResources,
  canEdit,
  canManageMembers,
  isOwner,
  isViewer,
  roleAtLeast,
  roleLabel,
  ROLE_DESCRIPTIONS,
} from "../permissions";
import type { WorkspaceRole } from "../types";

const ROLES: WorkspaceRole[] = ["viewer", "editor", "admin", "owner"];

describe("permissions (client RBAC mirror)", () => {
  it("orders roles by ascending privilege", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast(undefined, "viewer")).toBe(false);
  });

  it("gates editing on editor+", () => {
    expect(canEdit("viewer")).toBe(false);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("admin")).toBe(true);
    expect(canEdit("owner")).toBe(true);
    expect(canEdit(undefined)).toBe(false);
  });

  it("gates member management and destructive admin actions on admin+", () => {
    for (const role of ROLES) {
      const expected = role === "admin" || role === "owner";
      expect(canManageMembers(role)).toBe(expected);
      expect(canDeleteResources(role)).toBe(expected);
    }
  });

  it("identifies owner and viewer precisely", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
    expect(isViewer("viewer")).toBe(true);
    expect(isViewer("editor")).toBe(false);
  });

  it("labels and describes every role", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("viewer")).toBe("Viewer");
    for (const role of ROLES) {
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });
});
