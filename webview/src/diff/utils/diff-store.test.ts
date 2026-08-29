import { beforeEach, describe, expect, it } from "vitest";
import { useDiffStore } from "../../shared/store/diff-store";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

const meta = {
  filePath: "src/app.ts",
  leftRef: "aaaa111",
  rightRef: "bbbb222",
  leftLabel: "aaaa111",
  rightLabel: "bbbb222",
  language: "typescript",
};

const load = (left: string, right: string) =>
  useDiffStore.getState().setSides({ kind: "text", left, right, ...meta });

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

  it("empties the derived state when the host reports a fallback", () => {
    useDiffStore.getState().setSides({
      kind: "binary",
      leftBytes: 100,
      rightBytes: 200,
      differs: true,
      ...meta,
    });
    const state = useDiffStore.getState();
    expect(state.fallback?.kind).toBe("binary");
    expect(state.chunks).toEqual([]);
    expect(state.differences).toBe(0);
    expect(state.loading).toBe(false);
  });

  it("clears a previous fallback when text content arrives", () => {
    // "Show anyway" on an oversized diff: the forced text must replace the
    // placeholder, not sit behind it.
    useDiffStore.getState().setSides({
      kind: "tooLarge",
      lines: 30000,
      limit: 25000,
      ...meta,
    });
    load(lines("a"), lines("b"));
    const state = useDiffStore.getState();
    expect(state.fallback).toBeNull();
    expect(state.differences).toBe(1);
  });

  it("mirrors an image fallback's sides when swapped", () => {
    useDiffStore.getState().setSides({
      kind: "image",
      leftUri: undefined,
      rightUri: "data:image/png;base64,AA==",
      leftBytes: 0,
      rightBytes: 3,
      ...meta,
    });
    useDiffStore.getState().swapSides();
    const fallback = useDiffStore.getState().fallback;
    expect(fallback?.kind).toBe("image");
    if (fallback?.kind === "image") {
      expect(fallback.leftUri).toBe("data:image/png;base64,AA==");
      expect(fallback.rightUri).toBeUndefined();
      expect(fallback.leftBytes).toBe(3);
    }
  });
});

describe("fold state", () => {
  const longRun = () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
    // A modified first line, then a long equal run worth folding.
    useDiffStore.getState().setSides({
      kind: "text",
      left: lines("old", ...body),
      right: lines("new", ...body),
      ...meta,
    });
  };

  beforeEach(() => {
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
      syncScroll: true,
      expandedFolds: new Set<number>(),
      findOpen: false,
      findQuery: "",
    });
    longRun();
  });

  it("shortens the axis when a run folds, and restores it on expand", () => {
    const state = useDiffStore.getState();
    expect(state.folds).toHaveLength(1);
    const folded = state.axis;
    expect(folded).toBeLessThan(41);
    useDiffStore.getState().toggleFold(state.folds[0].left.start);
    expect(useDiffStore.getState().folds).toHaveLength(0);
    expect(useDiffStore.getState().axis).toBe(41);
  });

  it("re-collapses everything when collapsing is toggled back on", () => {
    const start = useDiffStore.getState().folds[0].left.start;
    useDiffStore.getState().toggleFold(start);
    useDiffStore.getState().toggleCollapseUnchanged();
    useDiffStore.getState().toggleCollapseUnchanged();
    expect(useDiffStore.getState().folds).toHaveLength(1);
  });

  it("forgets expansions when new content arrives", () => {
    const start = useDiffStore.getState().folds[0].left.start;
    useDiffStore.getState().toggleFold(start);
    longRun();
    expect(useDiffStore.getState().folds).toHaveLength(1);
  });

  it("expands the fold hiding the active find match", () => {
    useDiffStore.getState().openFind();
    // line20 is buried in the middle of the folded run.
    useDiffStore.getState().setFindQuery("line20");
    expect(useDiffStore.getState().matches.length).toBeGreaterThan(0);
    expect(useDiffStore.getState().folds).toHaveLength(1);
    useDiffStore.getState().revealActiveMatch();
    expect(useDiffStore.getState().folds).toHaveLength(0);
  });

  it("leaves the folds alone when the active match is already visible", () => {
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("new");
    useDiffStore.getState().revealActiveMatch();
    expect(useDiffStore.getState().folds).toHaveLength(1);
  });
});
