import { describe, expect, it } from "vitest";
import {
  autoResolveContent,
  type ConflictRegion,
  classifyRegion,
} from "./merge-model";

function region(
  base: string[],
  ours: string[],
  theirs: string[],
): ConflictRegion {
  return {
    start: 0,
    count: base.length,
    base,
    ours,
    theirs,
    oursStart: 0,
    theirsStart: 0,
    oursState: "pending",
    theirsState: "pending",
    edited: false,
  };
}

describe("classifyRegion", () => {
  it("calls a region one-side when only one flank moved", () => {
    expect(
      classifyRegion(region(["a", "b"], ["a", "changed"], ["a", "b"])),
    ).toBe("one-side");
    expect(
      classifyRegion(region(["a", "b"], ["a", "b"], ["changed", "b"])),
    ).toBe("one-side");
    // Neither side moved: still nothing to choose between.
    expect(classifyRegion(region(["a"], ["a"], ["a"]))).toBe("one-side");
  });

  it("calls disjoint edits auto-resolvable", () => {
    // Ours rewrites the first line, theirs the last: no shared base line.
    expect(
      classifyRegion(region(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"])),
    ).toBe("auto");
  });

  it("calls overlapping edits a real conflict", () => {
    // Both rewrote the same base line, differently.
    expect(
      classifyRegion(region(["a", "b"], ["ours", "b"], ["theirs", "b"])),
    ).toBe("conflict");
  });

  it("does not call an identical edit on both sides a conflict", () => {
    // Both made the same change: taking either is the same result.
    const same = region(["a", "b"], ["a", "same"], ["a", "same"]);
    expect(classifyRegion(same)).toBe("conflict");
    // Even so, the combined content must not duplicate the line.
    expect(autoResolveContent(same)).toEqual(["a", "same"]);
  });
});

describe("autoResolveContent", () => {
  it("combines edits at opposite ends of the region", () => {
    const merged = autoResolveContent(
      region(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"]),
    );
    expect(merged).toEqual(["A", "b", "C"]);
  });

  it("keeps untouched base lines between the two edits", () => {
    const merged = autoResolveContent(
      region(
        ["one", "two", "three", "four"],
        ["ONE", "two", "three", "four"],
        ["one", "two", "three", "FOUR"],
      ),
    );
    expect(merged).toEqual(["ONE", "two", "three", "FOUR"]);
  });

  it("applies a one-sided change unchanged", () => {
    expect(
      autoResolveContent(region(["a", "b"], ["a", "b", "added"], ["a", "b"])),
    ).toEqual(["a", "b", "added"]);
    expect(
      autoResolveContent(region(["a", "b"], ["a", "b"], ["a", "b", "added"])),
    ).toEqual(["a", "b", "added"]);
  });

  it("never silently drops a side's edit for an auto region", () => {
    // The property that matters: for anything classified auto, both sides'
    // new lines survive the combination.
    const cases: Array<[string[], string[], string[]]> = [
      [
        ["a", "b", "c"],
        ["A", "b", "c"],
        ["a", "b", "C"],
      ],
      [
        ["x", "y", "z"],
        ["x", "y", "z", "ours tail"],
        ["head", "x", "y", "z"],
      ],
    ];
    for (const [base, ours, theirs] of cases) {
      const candidate = region(base, ours, theirs);
      if (classifyRegion(candidate) !== "auto") continue;
      const merged = autoResolveContent(candidate).join("\n");
      for (const line of ours.filter((l) => !base.includes(l))) {
        expect(merged).toContain(line);
      }
      for (const line of theirs.filter((l) => !base.includes(l))) {
        expect(merged).toContain(line);
      }
    }
  });
});
