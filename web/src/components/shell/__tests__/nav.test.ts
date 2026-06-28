import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "../../../lib/types";
import { PRIMARY_TABS, WORKSPACE_NAV, visibleSettings } from "../nav";

const keysFor = (role: WorkspaceRole | undefined) => visibleSettings(role).map((i) => i.key);

describe("shell nav config", () => {
  it("keeps the primary tabs to just Workflows and Templates", () => {
    expect(PRIMARY_TABS.map((t) => t.key)).toEqual(["workflows", "templates"]);
  });

  it("exposes Runs and Analytics in the Workspace group for every role", () => {
    expect(WORKSPACE_NAV.map((t) => t.key)).toEqual(["runs", "analytics"]);
  });

  it("hides admin-only Settings items from viewers and editors", () => {
    // Viewers/editors only get the items they can actually use; Members, API keys,
    // and Activity (audit) are admin/owner-only and must not appear.
    expect(keysFor("viewer")).toEqual(["credentials", "variables"]);
    expect(keysFor("editor")).toEqual(["credentials", "variables"]);
  });

  it("shows the full Settings group to admins and owners", () => {
    const all = ["members", "credentials", "variables", "apiKeys", "activity"];
    expect(keysFor("admin")).toEqual(all);
    expect(keysFor("owner")).toEqual(all);
  });

  it("treats an unknown/absent role as least-privileged", () => {
    expect(keysFor(undefined)).toEqual(["credentials", "variables"]);
  });
});
