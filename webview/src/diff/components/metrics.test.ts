import { describe, expect, it } from "vitest";
import { GUTTER_GAP, gutterMetrics } from "./metrics";

describe("gutterMetrics", () => {
  it("keeps the familiar proportions for files up to four digits", () => {
    expect(gutterMetrics(1).numberWidth).toBe(gutterMetrics(9999).numberWidth);
  });

  it("widens the columns once line numbers pass four digits", () => {
    // The rough edge this closes: a fixed 26px column crowded past 9999.
    expect(gutterMetrics(10000).numberWidth).toBeGreaterThan(
      gutterMetrics(9999).numberWidth,
    );
    expect(gutterMetrics(100000).numberWidth).toBeGreaterThan(
      gutterMetrics(10000).numberWidth,
    );
  });

  it("moves the gap with the columns so the bend zone stays gap-wide", () => {
    const metrics = gutterMetrics(123456);
    expect(metrics.gapStart).toBe(metrics.numberWidth);
    expect(metrics.gapEnd - metrics.gapStart).toBe(GUTTER_GAP);
    expect(metrics.width).toBe(metrics.numberWidth * 2 + GUTTER_GAP);
  });

  it("never narrows below the four-digit floor", () => {
    expect(gutterMetrics(0).numberWidth).toBeGreaterThanOrEqual(26);
  });
});
