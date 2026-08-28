import { beforeEach, describe, expect, it } from "vitest";
import { useDiffStore } from "../../shared/store/diff-store";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

const load = (left: string, right: string) =>
  useDiffStore.getState().setSides({
    left,
    right,
    filePath: "src/app.ts",
    leftRef: "aaaa111",
    rightRef: "bbbb222",
    language: "typescript",
  });

describe("diff store", () => {
  beforeEach(() => {
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
      syncScroll: true,
    });
    load(lines("a", "b", "c"), lines("a", "B", "c"));
  });

  it("derives chunks, difference count and axis length from the two sides", () => {
    const state = useDiffStore.getState();
    expect(state.differences).toBe(1);
    expect(state.axis).toBe(3);
    expect(state.loading).toBe(false);
  });

  it("recomputes when the whitespace option changes", () => {
    load(lines("a", "  b"), lines("a", "b"));
    expect(useDiffStore.getState().differences).toBe(1);
    useDiffStore.getState().setWhitespace("trim");
    expect(useDiffStore.getState().differences).toBe(0);
  });

  it("drops folds entirely when collapsing is turned off", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
    load(lines(...body), lines(...body, "extra"));
    expect(useDiffStore.getState().folds.length).toBeGreaterThan(0);
    useDiffStore.getState().toggleCollapseUnchanged();
    expect(useDiffStore.getState().folds).toEqual([]);
  });

  it("re-runs the diff when sides are swapped rather than relabelling chunks", () => {
    // An addition seen from the other side is a deletion, not an addition with
    // a different name, so the chunk kinds have to actually change.
    load(lines("a"), lines("a", "b"));
    expect(useDiffStore.getState().chunks.map((c) => c.kind)).toContain(
      "added",
    );
    useDiffStore.getState().swapSides();
    const after = useDiffStore.getState();
    expect(after.chunks.map((c) => c.kind)).toContain("removed");
    expect(after.leftRef).toBe("bbbb222");
    expect(after.swapped).toBe(true);
  });

  it("steps forward from nothing onto the first difference", () => {
    load(lines("a", "b", "c", "d"), lines("A", "b", "C", "d"));
    useDiffStore.getState().stepDifference(1);
    const first = useDiffStore.getState().activeChunk;
    useDiffStore.getState().stepDifference(1);
    expect(useDiffStore.getState().activeChunk).toBeGreaterThan(first);
  });

  it("steps backward from nothing onto the last difference", () => {
    load(lines("a", "b", "c", "d"), lines("A", "b", "C", "d"));
    useDiffStore.getState().stepDifference(-1);
    const last = useDiffStore.getState().activeChunk;
    useDiffStore.getState().stepDifference(1);
    // Wrapping past the end returns to the first.
    expect(useDiffStore.getState().activeChunk).toBeLessThan(last);
  });

  it("wraps rather than sticking at either end", () => {
    load(lines("a", "b"), lines("A", "b"));
    useDiffStore.getState().stepDifference(1);
    const only = useDiffStore.getState().activeChunk;
    useDiffStore.getState().stepDifference(1);
    expect(useDiffStore.getState().activeChunk).toBe(only);
  });

  it("does nothing when there are no differences to step through", () => {
    load(lines("a", "b"), lines("a", "b"));
    useDiffStore.getState().stepDifference(1);
    expect(useDiffStore.getState().activeChunk).toBe(-1);
    expect(useDiffStore.getState().activeChunkAxis()).toBeNull();
  });

  it("reports an axis position that reveals the active difference", () => {
    load(lines("a", "b", "c"), lines("a", "x", "y", "b", "c"));
    useDiffStore.getState().stepDifference(1);
    expect(useDiffStore.getState().activeChunkAxis()).toBe(1);
  });
});
