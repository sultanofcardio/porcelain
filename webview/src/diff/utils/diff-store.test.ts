import { beforeEach, describe, expect, it } from "vitest";
import { WORKING_TREE_REF } from "../../shared/bridge/types";
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

const load = (left: string, right: string, filePath = meta.filePath) =>
  useDiffStore
    .getState()
    .setSides({ kind: "text", left, right, ...meta, filePath });

// The store is a singleton, and a reload of the same document deliberately
// carries carets and expansions forward: each test starts from the state the
// module was imported with so nothing leaks between them.
const pristine = useDiffStore.getState();

describe("diff store", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
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
    // Another file, so this is a fresh diff rather than a reload of the one
    // the fixture opened: a reload keeps its carets, and a caret inside a
    // run holds that run open.
    load(lines(...body), lines(...body, "extra"), "src/long.ts");
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
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
      syncScroll: true,
      expandedFolds: new Set<number>(),
      findOpen: false,
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

  it("forgets expansions when another file arrives", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const start = useDiffStore.getState().folds[0].left.start;
    useDiffStore.getState().toggleFold(start);
    useDiffStore.getState().setSides({
      kind: "text",
      left: lines("old", ...body),
      right: lines("new", ...body),
      ...meta,
      filePath: "src/other.ts",
    });
    expect(useDiffStore.getState().folds).toHaveLength(1);
  });

  it("re-collapses hand-expanded folds without touching the feature toggle", () => {
    // The toolbar's collapse toggle: with collapsing on and a fold expanded,
    // "collapse" must fold it again rather than turn collapsing off.
    useDiffStore
      .getState()
      .toggleFold(useDiffStore.getState().folds[0].left.start);
    expect(useDiffStore.getState().folds).toHaveLength(0);
    useDiffStore.getState().setCollapsed(true);
    const state = useDiffStore.getState();
    expect(state.collapseUnchanged).toBe(true);
    expect(state.folds).toHaveLength(1);
  });

  it("expands everything when the collapse toggle is released", () => {
    useDiffStore.getState().setCollapsed(false);
    const state = useDiffStore.getState();
    expect(state.folds).toHaveLength(0);
    expect(state.axis).toBe(41);
  });

  it("expands the fold hiding the active find match", () => {
    useDiffStore.getState().openFind();
    // line20 is buried in the middle of the folded run.
    useDiffStore.getState().setFindQuery("right", "line20");
    expect(useDiffStore.getState().findRight.matches.length).toBeGreaterThan(0);
    expect(useDiffStore.getState().folds).toHaveLength(1);
    useDiffStore.getState().revealActiveMatch("right");
    expect(useDiffStore.getState().folds).toHaveLength(0);
  });

  it("leaves the folds alone when the active match is already visible", () => {
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "new");
    useDiffStore.getState().revealActiveMatch("right");
    expect(useDiffStore.getState().folds).toHaveLength(1);
  });

  // A change, the same forty lines, another change: the run is interior, so
  // it keeps three lines of context on each edge and hides lines 4..37.
  const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
  const twoChanges = (
    refs = { leftRef: meta.leftRef, rightRef: meta.rightRef },
  ) =>
    useDiffStore.getState().setSides({
      kind: "text",
      left: lines("old", ...body, "tail-old"),
      right: lines("new", ...body, "tail-new"),
      ...meta,
      ...refs,
      filePath: "src/two.ts",
    });
  const fold = () => useDiffStore.getState().folds[0];

  it("opens a fold in stages from its head when the caret sits above it", () => {
    // Every caret starts on the first change, above the run.
    const key = fold().key;
    expect(key).toBe(4);
    const folded = useDiffStore.getState().axis;
    expect(useDiffStore.getState().revealFold(key).rows).toBe(0);
    expect(fold().key).toBe(key);
    expect(fold().left).toEqual({ start: 8, count: 33 });
    expect(fold().revealed).toEqual({ head: 4, tail: 0 });
    expect(useDiffStore.getState().axis).toBe(folded + 4);
    useDiffStore.getState().revealFold(key);
    expect(fold().left).toEqual({ start: 16, count: 25 });
    // The third step opens the rest, which is what expansion already means.
    useDiffStore.getState().revealFold(key);
    const state = useDiffStore.getState();
    expect(state.folds).toHaveLength(0);
    expect(state.expandedFolds.has(key)).toBe(true);
    expect(state.foldReveals.size).toBe(0);
    expect(state.axis).toBe(41);
  });

  it("opens from the tail below a caret, reporting the rows that push the caret", () => {
    twoChanges();
    useDiffStore.getState().placeCaret("right", { line: 41, col: 0 });
    const key = fold().key;
    expect(useDiffStore.getState().revealFold(key)).toEqual({
      pane: "right",
      caretRow: 8,
      rows: 4,
    });
    expect(fold().left).toEqual({ start: 4, count: 30 });
    expect(fold().revealed).toEqual({ head: 0, tail: 4 });
    // Each end keeps its own count: a caret moved above the run opens its
    // head from the first stage, and the tail's progress stays.
    useDiffStore.getState().placeCaret("right", { line: 0, col: 0 });
    expect(useDiffStore.getState().revealFold(key).rows).toBe(0);
    expect(fold().revealed).toEqual({ head: 4, tail: 4 });
    expect(fold().left).toEqual({ start: 8, count: 26 });
  });

  it("reports the caret's push in rows when the view is unified", () => {
    twoChanges();
    useDiffStore.getState().setViewMode("unified");
    useDiffStore.getState().placeCaret("right", { line: 41, col: 0 });
    expect(useDiffStore.getState().revealFold(fold().key).rows).toBe(4);
  });

  it("keeps a partial reveal on its run across an edit above it", () => {
    // The keys are left line numbers, so an editable left side is what can
    // move them: a line inserted at the top shifts the run down by one.
    twoChanges({ leftRef: WORKING_TREE_REF, rightRef: meta.rightRef });
    const key = fold().key;
    useDiffStore.getState().revealFold(key);
    expect(fold().left).toEqual({ start: 8, count: 30 });
    useDiffStore
      .getState()
      .editAt(
        { anchor: { line: 0, col: 0 }, head: { line: 0, col: 0 } },
        "inserted\n",
        null,
      );
    expect(fold().key).toBe(key + 1);
    expect(fold().revealed).toEqual({ head: 4, tail: 0 });
    expect(fold().left).toEqual({ start: 9, count: 30 });
  });

  it("forgets partial reveals when the context width or the collapse toggle changes", () => {
    useDiffStore.getState().revealFold(fold().key);
    expect(useDiffStore.getState().foldReveals.size).toBe(1);
    useDiffStore.getState().setContextLines(5);
    expect(useDiffStore.getState().foldReveals.size).toBe(0);
    expect(fold().revealed).toEqual({ head: 0, tail: 0 });
    expect(fold().hiddenLines).toBe(35);
    useDiffStore.getState().revealFold(fold().key);
    expect(fold().hiddenLines).toBe(31);
    // The toolbar's collapse: partly opened runs close along with expanded ones.
    useDiffStore.getState().setCollapsed(true);
    expect(useDiffStore.getState().foldReveals.size).toBe(0);
    expect(fold().hiddenLines).toBe(35);
  });

  it("expands a partly opened fold whole for a find match still hidden in it", () => {
    const key = fold().key;
    useDiffStore.getState().revealFold(key);
    useDiffStore.getState().openFind();
    // line20 sits on line 21, inside what the run still hides.
    useDiffStore.getState().setFindQuery("right", "line20");
    useDiffStore.getState().revealActiveMatch("right");
    const state = useDiffStore.getState();
    expect(state.folds).toHaveLength(0);
    expect(state.foldReveals.size).toBe(0);
  });

  it("brings the whole run back when a partly opened fold is toggled shut", () => {
    const key = fold().key;
    useDiffStore.getState().revealFold(key);
    useDiffStore.getState().toggleFold(key);
    expect(useDiffStore.getState().folds).toHaveLength(0);
    useDiffStore.getState().toggleFold(key);
    expect(fold().hiddenLines).toBe(37);
    expect(fold().revealed).toEqual({ head: 0, tail: 0 });
  });

  it("keeps each bar's search independent of the other side", () => {
    // The IntelliJ shape: two bars, two match walks. "old" exists only on
    // the left, and the right bar must not see it.
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("left", "old");
    useDiffStore.getState().setFindQuery("right", "old");
    expect(useDiffStore.getState().findLeft.matches).toHaveLength(1);
    expect(useDiffStore.getState().findRight.matches).toHaveLength(0);
    // The box follows the bar that last acted.
    expect(useDiffStore.getState().activeFindSide).toBe("right");
  });
});
