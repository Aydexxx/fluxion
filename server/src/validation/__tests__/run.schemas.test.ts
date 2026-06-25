import { describe, expect, it } from "vitest";
import { analyticsQuerySchema, listWorkspaceRunsQuerySchema, runIdParamSchema, runLogsQuerySchema } from "../run.schemas";

describe("listWorkspaceRunsQuerySchema", () => {
  it("requires workspaceId", () => {
    expect(listWorkspaceRunsQuerySchema.safeParse({}).success).toBe(false);
  });

  it("accepts a valid query and coerces limit to a number", () => {
    const result = listWorkspaceRunsQuerySchema.safeParse({ workspaceId: "ws1", status: "failed", limit: "25" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(25);
  });

  it("rejects an invalid status", () => {
    expect(listWorkspaceRunsQuerySchema.safeParse({ workspaceId: "ws1", status: "explode" }).success).toBe(false);
  });

  it("rejects a non-date `from`", () => {
    expect(listWorkspaceRunsQuerySchema.safeParse({ workspaceId: "ws1", from: "not-a-date" }).success).toBe(false);
  });

  it("rejects a limit over the cap", () => {
    expect(listWorkspaceRunsQuerySchema.safeParse({ workspaceId: "ws1", limit: "9999" }).success).toBe(false);
  });

  it("accepts trigger, search, and an opaque cursor", () => {
    const result = listWorkspaceRunsQuerySchema.safeParse({
      workspaceId: "ws1",
      trigger: "webhook",
      search: "  invoices  ",
      cursor: "MjAyNi0wNi0yNXxydW5fMQ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trigger).toBe("webhook");
      expect(result.data.search).toBe("invoices"); // trimmed
      expect(result.data.cursor).toBe("MjAyNi0wNi0yNXxydW5fMQ");
    }
  });

  it("rejects an invalid trigger and a blank search", () => {
    expect(listWorkspaceRunsQuerySchema.safeParse({ workspaceId: "ws1", trigger: "telepathy" }).success).toBe(false);
    expect(listWorkspaceRunsQuerySchema.safeParse({ workspaceId: "ws1", search: "   " }).success).toBe(false);
  });
});

describe("runLogsQuerySchema", () => {
  it("accepts an empty query and coerces `after` to a non-negative integer", () => {
    expect(runLogsQuerySchema.safeParse({}).success).toBe(true);
    const result = runLogsQuerySchema.safeParse({ after: "12" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.after).toBe(12);
  });

  it("rejects a negative or non-numeric `after`", () => {
    expect(runLogsQuerySchema.safeParse({ after: "-1" }).success).toBe(false);
    expect(runLogsQuerySchema.safeParse({ after: "soon" }).success).toBe(false);
  });
});

describe("analyticsQuerySchema", () => {
  it("accepts valid ISO dates", () => {
    expect(analyticsQuerySchema.safeParse({ workspaceId: "ws1", from: "2026-06-01T00:00:00Z" }).success).toBe(true);
  });

  it("rejects a missing workspaceId", () => {
    expect(analyticsQuerySchema.safeParse({ from: "2026-06-01T00:00:00Z" }).success).toBe(false);
  });
});

describe("runIdParamSchema", () => {
  it("requires a non-empty id", () => {
    expect(runIdParamSchema.safeParse({ id: "" }).success).toBe(false);
    expect(runIdParamSchema.safeParse({ id: "run_123" }).success).toBe(true);
  });
});
