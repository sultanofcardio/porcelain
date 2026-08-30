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
  it("is zero while both sides are moving and no gap is near", () => {
    // The equal run is ten lines and the ramp is fifteen, so this one is
    // ramping from its very start; a run with room to spare is flat first.
    const roomy: DiffChunk[] = [
      {
        kind: "equal",
        left: { start: 0, count: 40 },
        right: { start: 0, count: 40 },
      },
      {
        kind: "added",
        left: { start: 40, count: 0 },
        right: { start: 40, count: 20 },
      },
    ];
    for (const position of [0, 3, 20, 25]) {
      expect(stallLift(roomy, position, "left", VIEWPORT)).toBe(0);
      expect(stallLift(roomy, position, "right", VIEWPORT)).toBe(0);
    }
  });

  it("never lifts the side that is actually scrolling", () => {
    // The right side has all twenty inserted lines: it is not stalled.
    for (const position of [12, 20, 28]) {
      expect(stallLift(chunks, position, "right", VIEWPORT)).toBe(0);
    }
  });

  it("reaches full lift before the gap starts, not inside it", () => {
    // The regression this pins: ramping in only once inside the gap lets the
    // stalled side travel all the way to the top of the window first, then
    // slide back down to the middle — a visible bounce. The lift must already
    // be at its plateau the moment the gap begins.
    const peak = stallLift(chunks, 10, "left", VIEWPORT);
    expect(peak).toBeCloseTo(VIEWPORT / 2, 5);

    // The approach ramps up through the equal run ahead of the gap.
    expect(stallLift(chunks, 5, "left", VIEWPORT)).toBeGreaterThan(0);
    expect(stallLift(chunks, 5, "left", VIEWPORT)).toBeLessThan(peak);
    expect(stallLift(chunks, 8, "left", VIEWPORT)).toBeGreaterThan(
      stallLift(chunks, 5, "left", VIEWPORT),
    );
  });

  it("holds the plateau flat for the gap's whole length", () => {
    // No peak in the middle: the anchor parks and stays parked while the
    // other side catches up.
    const held = [10, 12, 20, 25, 29.5].map((position) =>
      stallLift(chunks, position, "left", VIEWPORT),
    );
    for (const lift of held) expect(lift).toBeCloseTo(held[0], 5);
  });

  it("eases back out after the gap rather than dropping", () => {
    // Continuous across the far edge…
    expect(stallLift(chunks, 30, "left", VIEWPORT)).toBeCloseTo(
      stallLift(chunks, 29.9, "left", VIEWPORT),
      1,
    );
    // …then decays through the equal run that follows.
    expect(stallLift(chunks, 35, "left", VIEWPORT)).toBeLessThan(
      stallLift(chunks, 31, "left", VIEWPORT),
    );
    expect(stallLift(chunks, 40, "left", VIEWPORT)).toBe(0);
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
    const deep = 10 + VIEWPORT; // well inside the gap
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
    // A four-line gap in a thirty-line viewport is held four lines down, not
    // fifteen: parking the anchor deeper than the gap would push the side
    // back further than standing still can justify.
    for (const position of [5, 6, 7, 8.5]) {
      expect(stallLift(shortGap, position, "left", VIEWPORT)).toBeCloseTo(4, 5);
    }
  });

  it("does not dip between two gaps close together", () => {
    // The run between them is shorter than the ramp, so the departure of the
    // first and the approach of the second overlap; taking the higher of the
    // two keeps the anchor from bobbing back up in between.
    const twoGaps: DiffChunk[] = [
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
        left: { start: 10, count: 4 },
        right: { start: 30, count: 4 },
      },
      {
        kind: "added",
        left: { start: 14, count: 0 },
        right: { start: 34, count: 20 },
      },
    ];
    // Across the short run between the two gaps the lift does not move at all.
    const plateau = VIEWPORT / 2;
    for (const position of [30, 31, 32, 33]) {
      expect(stallLift(twoGaps, position, "left", VIEWPORT)).toBeCloseTo(
        plateau,
        5,
      );
    }
  });

  it("still releases the side when the gaps are far apart", () => {
    // A run with room to ramp down and back up does exactly that, rather than
    // staying parked across a long stretch both sides can scroll together.
    const farApart: DiffChunk[] = [
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
        left: { start: 10, count: 90 },
        right: { start: 30, count: 90 },
      },
      {
        kind: "added",
        left: { start: 100, count: 0 },
        right: { start: 120, count: 20 },
      },
    ];
    // Mid-run, well clear of both gaps, the lift is fully released.
    expect(stallLift(farApart, 70, "left", VIEWPORT)).toBe(0);
  });

  it("starts slowing well before a gap that a short run leads into", () => {
    // The shape that kept bouncing in practice: an edit, the two lines after
    // it, then a large insertion. Ramping only inside the run immediately
    // before the gap leaves two lines to decelerate in, so the side reaches
    // the top at full speed and is snapped back to the middle. The ramp is a
    // distance to the gap, so it reaches back through the edit and the run
    // before it.
    const realistic: DiffChunk[] = [
      {
        kind: "equal",
        left: { start: 0, count: 12 },
        right: { start: 0, count: 12 },
      },
      {
        kind: "modified",
        left: { start: 12, count: 1 },
        right: { start: 12, count: 1 },
      },
      {
        kind: "equal",
        left: { start: 13, count: 2 },
        right: { start: 13, count: 2 },
      },
      {
        kind: "added",
        left: { start: 15, count: 0 },
        right: { start: 15, count: 40 },
      },
    ];
    const plateau = VIEWPORT / 2;
    // At the gap's edge the side is already parked.
    expect(stallLift(realistic, 15, "left", VIEWPORT)).toBeCloseTo(plateau, 5);
    // Ten lines out — back inside the long equal run, two chunks before the
    // gap — the deceleration has already begun, a third of the way through a
    // fifteen-line ramp. The old behaviour was flat zero here, which is what
    // left the side no room and produced the snap.
    expect(stallLift(realistic, 5, "left", VIEWPORT)).toBeCloseTo(
      plateau / 3,
      5,
    );
    // Five lines out, two thirds of the way.
    expect(stallLift(realistic, 10, "left", VIEWPORT)).toBeCloseTo(
      (plateau * 2) / 3,
      5,
    );
    // And it only ever climbs on the way in: no dip, no reversal.
    let previous = 0;
    for (const position of [2, 4, 6, 8, 10, 12, 13, 14, 15]) {
      const lift = stallLift(realistic, position, "left", VIEWPORT);
      expect(lift).toBeGreaterThanOrEqual(previous);
      previous = lift;
    }
  });

  it("never moves the stalled pane backwards, which is the bounce itself", () => {
    // What the panes actually render is `axisToSide - stallLift`. The bounce
    // the user saw was that value rising and then falling: the side scrolled
    // up to the top and came back down. Whatever the lift does, this must be
    // monotonic — and it is only monotonic because the ramp exactly cancels
    // the mapping's advance, which is what parks the anchor mid-window
    // instead of merely slowing it.
    const realistic: DiffChunk[] = [
      {
        kind: "equal",
        left: { start: 0, count: 12 },
        right: { start: 0, count: 12 },
      },
      {
        kind: "modified",
        left: { start: 12, count: 1 },
        right: { start: 12, count: 1 },
      },
      {
        kind: "equal",
        left: { start: 13, count: 2 },
        right: { start: 13, count: 2 },
      },
      {
        kind: "added",
        left: { start: 15, count: 0 },
        right: { start: 15, count: 40 },
      },
      {
        kind: "equal",
        left: { start: 15, count: 30 },
        right: { start: 55, count: 30 },
      },
    ];
    const offsetAt = (position: number) =>
      axisToSide(realistic, position, "left") -
      stallLift(realistic, position, "left", VIEWPORT);

    let previous = Number.NEGATIVE_INFINITY;
    for (let position = 0; position <= 85; position += 0.25) {
      const offset = offsetAt(position);
      expect(offset).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = offset;
    }

    // And while it is parked, the insertion point sits at the middle of the
    // window rather than its top: the left pane's top row is half a viewport
    // above the line the new lines go in at.
    for (const position of [15, 25, 40, 54]) {
      expect(offsetAt(position)).toBeCloseTo(15 - VIEWPORT / 2, 5);
    }
  });

  it("is inert without a measured viewport", () => {
    expect(stallLift(chunks, 20, "left", 0)).toBe(0);
  });
});
