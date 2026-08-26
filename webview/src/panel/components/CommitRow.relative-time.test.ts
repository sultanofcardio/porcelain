import { describe, expect, it } from "vitest";
import { formatDateTime, formatRelativeTime } from "./CommitRow";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it.each([
    [0, "just now"],
    [30 * SECOND, "just now"],
    [MINUTE, "1 minute ago"],
    [2 * MINUTE, "2 minutes ago"],
    [59 * MINUTE, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [23 * HOUR, "23 hours ago"],
    [DAY, "1 day ago"],
    [29 * DAY, "29 days ago"],
  ])("renders %i ms ago as %s", (elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it("falls back to the absolute date once relative stops being readable", () => {
    const old = ago(30 * DAY);
    expect(formatRelativeTime(old, NOW)).toBe(formatDateTime(old));
  });

  it("singularizes the boundary units", () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).not.toContain("minutes");
    expect(formatRelativeTime(ago(HOUR), NOW)).not.toContain("hours");
    expect(formatRelativeTime(ago(DAY), NOW)).not.toContain("days");
  });

  it("shows an absolute date for a commit dated in the future", () => {
    // Clock skew between machines makes this reachable; "in -3 minutes" is not
    // something to render.
    const ahead = new Date(NOW + 5 * MINUTE).toISOString();
    expect(formatRelativeTime(ahead, NOW)).toBe(formatDateTime(ahead));
  });

  it("passes an unparseable date through untouched", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("not-a-date");
  });
});
