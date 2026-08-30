import { describe, expect, it } from "vitest";
import {
  type ConflictRegion,
  resultRegionAnchors,
  resultRegionKinds,
} from "./merge-model";

function region(overrides: Partial<ConflictRegion> = {}): ConflictRegion {
  return {
    start: 10,
    count: 0,
    base: [],
    ours: ["ours"],
    theirs: ["theirs"],
    oursStart: 10,
    theirsStart: 10,
    oursState: "pending",
    theirsState: "pending",
    edited: false,
    ...overrides,
  };
}

describe("resultRegionAnchors", () => {
  it("marks a conflict that occupies no rows in the result", () => {
    // Both sides added where the base had nothing: the region is zero rows
    // tall, so the row-keyed paint has nothing to colour.
    const zeroHeight = region();
    expect(resultRegionKinds([zeroHeight]).size).toBe(0);

    expect(resultRegionAnchors([zeroHeight])).toEqual([
      { line: 10, kind: "conflict" },
    ]);
  });

  it("leaves regions that already paint rows alone", () => {
    // A region with rows in the result is coloured by resultRegionKinds; an
    // anchor there would double-draw.
    const tall = region({ count: 3, base: ["a", "b", "c"] });
    expect(resultRegionKinds([tall]).size).toBe(3);
    expect(resultRegionAnchors([tall])).toEqual([]);
  });

  it("follows the region's state once it is resolved", () => {
    const accepted = region({ oursState: "accepted", theirsState: "ignored" });
    expect(resultRegionAnchors([accepted])).toEqual([
      { line: 10, kind: "resolved" },
    ]);

    const typed = region({ edited: true });
    expect(resultRegionAnchors([typed])).toEqual([
      { line: 10, kind: "resolved" },
    ]);
  });

  it("reports every zero-height region, in order", () => {
    const anchors = resultRegionAnchors([
      region({ start: 4 }),
      region({ start: 9, count: 2, base: ["x", "y"] }),
      region({ start: 20 }),
    ]);
    expect(anchors.map((anchor) => anchor.line)).toEqual([4, 20]);
  });
});
