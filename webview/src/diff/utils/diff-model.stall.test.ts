import { describe, expect, it } from "vitest";
import { axisToSide, type DiffChunk, stallLift } from "./diff-model";

/**
 * Ten equal lines, a twenty-line insertion on the right, ten equal lines.
 * The left side stands still for the whole insertion.
 */
const chunks: DiffChunk[] = [
  {
    kind: "equal",
    left: { start: 0, count: 10 },
    right: { start: 0, count: 10 },
  },
  {
    kind: "added",
    left: { start: 10, count: 0 },
    right: { start: 10, count: 20 },
  },
  {
    kind: "equal",
    left: { start: 10, count: 10 },
    right: { start: 30, count: 10 },
  },
];
const VIEWPORT = 30;

describe("stallLift", () => {
  it("is zero while both sides are moving", () => {
    for (const position of [0, 3, 9]) {
      expect(stallLift(chunks, position, "left", VIEWPORT)).toBe(0);
      expect(stallLift(chunks, position, "right", VIEWPORT)).toBe(0);
    }
  });

  it("never lifts the side that is actually scrolling", () => {
    // The right side has all twenty inserted lines: it is not stalled.
    for (const position of [12, 20, 28]) {
      expect(stallLift(chunks, position, "right", VIEWPORT)).toBe(0);
    }
  });

  it("eases in from the gap's edge and peaks at its middle", () => {
    // Just inside: barely lifted, so entering eases rather than jumps.
    expect(stallLift(chunks, 10.5, "left", VIEWPORT)).toBeCloseTo(0.5, 5);
    // The peak sits at the gap's midpoint, symmetric about it.
    const midpoint = 20;
    const peak = stallLift(chunks, midpoint, "left", VIEWPORT);
    expect(peak).toBeGreaterThan(stallLift(chunks, 15, "left", VIEWPORT));
    expect(peak).toBeGreaterThan(stallLift(chunks, 25, "left", VIEWPORT));
    expect(stallLift(chunks, 15, "left", VIEWPORT)).toBeCloseTo(
      stallLift(chunks, 25, "left", VIEWPORT),
      5,
    );
    // Leaving eases back out to nothing.
    expect(stallLift(chunks, 29.5, "left", VIEWPORT)).toBeCloseTo(0.5, 5);
    expect(stallLift(chunks, 30, "left", VIEWPORT)).toBe(0);
  });

  it("centres the anchor once the gap is long enough to afford it", () => {
    // A gap wider than a viewport can hold the anchor at the true middle.
    const wide: DiffChunk[] = [
      {
        kind: "equal",
        left: { start: 0, count: 10 },
        right: { start: 0, count: 10 },
      },
      {
        kind: "added",
        left: { start: 10, count: 0 },
        right: { start: 10, count: 80 },
      },
    ];
    const deep = 10 + VIEWPORT; // well past the ramp, far from the far edge
    const raw = axisToSide(wide, deep, "left");
    const lift = stallLift(wide, deep, "left", VIEWPORT);

    // Raw mapping pins the anchor to the pane's top row…
    expect(raw).toBe(10);
    // …the lift puts it half a viewport down, so the lines before the
    // insertion stay on screen instead of being pushed off the top.
    expect(lift).toBeCloseTo(VIEWPORT / 2, 5);
    expect(raw - lift).toBeCloseTo(10 - VIEWPORT / 2, 5);
  });

  it("never lifts a short gap to more than it can use", () => {
    const shortGap: DiffChunk[] = [
      {
        kind: "equal",
        left: { start: 0, count: 5 },
        right: { start: 0, count: 5 },
      },
      {
        kind: "added",
        left: { start: 5, count: 0 },
        right: { start: 5, count: 4 },
      },
    ];
    // A four-line gap in a thirty-line viewport never reaches full lift.
    for (const position of [5.5, 6, 7, 8.5]) {
      const lift = stallLift(shortGap, position, "left", VIEWPORT);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThan(VIEWPORT / 2);
    }
  });

  it("is inert without a measured viewport", () => {
    expect(stallLift(chunks, 20, "left", 0)).toBe(0);
  });
});
