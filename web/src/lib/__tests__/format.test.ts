import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration, timeAgo } from "../format";

describe("formatDuration", () => {
  const base = "2026-06-28T12:00:00.000Z";
  const plus = (ms: number) => new Date(Date.parse(base) + ms).toISOString();

  it("returns an em dash for missing or invalid spans", () => {
    expect(formatDuration(null, base)).toBe("—");
    expect(formatDuration(base, null)).toBe("—");
    expect(formatDuration(base, plus(-100))).toBe("—"); // negative
  });

  it("formats sub-second, seconds, and minute spans", () => {
    expect(formatDuration(base, plus(820))).toBe("820ms");
    expect(formatDuration(base, plus(1400))).toBe("1.4s");
    expect(formatDuration(base, plus(12_000))).toBe("12s"); // >=10s drops the decimal
    expect(formatDuration(base, plus(123_000))).toBe("2m 3s");
  });
});

describe("timeAgo", () => {
  afterEach(() => vi.useRealTimers());

  it("renders compact relative time", () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-28T12:00:00.000Z");
    vi.setSystemTime(now);
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

    expect(timeAgo(ago(10_000))).toBe("just now");
    expect(timeAgo(ago(5 * 60_000))).toBe("5m ago");
    expect(timeAgo(ago(3 * 3_600_000))).toBe("3h ago");
    expect(timeAgo(ago(2 * 86_400_000))).toBe("2d ago");
    expect(timeAgo(ago(2 * 7 * 86_400_000))).toBe("2w ago");
  });

  it("returns empty string for an invalid date", () => {
    expect(timeAgo("not-a-date")).toBe("");
  });
});
