import { beforeEach, describe, expect, it } from "vitest";
import { WORKING_TREE_REF } from "../../shared/bridge/types";
import {
  caretOn,
  editSourcePosition,
  useDiffStore,
} from "../../shared/store/diff-store";
import { caretAt } from "../editor/editor-model";
import type { Side } from "./diff-model";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

// The store is a singleton: every test starts from the state the module was
// imported with, so nothing a previous one placed or expanded carries over.
const pristine = useDiffStore.getState();

const meta = {
  filePath: "src/app.ts",
  leftLabel: "HEAD",
  rightLabel: "Working tree",
  language: "typescript",
};

const load = (
  left: string,
  right: string,
  refs = { leftRef: "aaaa111", rightRef: WORKING_TREE_REF },
) =>
  useDiffStore
    .getState()
    .setSides({ kind: "text", left, right, ...meta, ...refs });

// Eight equal lines, a change, four equal lines: with three context lines the
// leading run folds and the caret lands on line 8 of both sides.
const before = lines(
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "old",
  "x",
  "y",
  "z",
  "w",
);
const after = lines(
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "new",
  "x",
  "y",
  "z",
  "w",
);

/** The folds hiding `line` on `side`, which must always be none. */
const hiding = (side: Side, line: number) =>
  useDiffStore.getState().folds.filter((fold) => {
    const span = side === "left" ? fold.left : fold.right;
    return line >= span.start && line < span.start + span.count;
  });

describe("carets on every pane", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
    });
    load(before, after);
  });

  it("opens with a caret on the first changed line of each side", () => {
    const state = useDiffStore.getState();
    expect(state.cursor).toEqual({
      anchor: { line: 8, col: 0 },
      head: { line: 8, col: 0 },
    });
    expect(state.readOnlyCarets).toEqual({
      left: { line: 8, col: 0 },
      right: null,
    });
    expect(state.activePane).toBe("right");
  });

  it("gives both sides a read-only caret when nothing can be edited", () => {
    load(before, after, { leftRef: "aaaa111", rightRef: "bbbb222" });
    const state = useDiffStore.getState();
    expect(state.cursor).toBeNull();
    expect(state.readOnlyCarets).toEqual({
      left: { line: 8, col: 0 },
      right: { line: 8, col: 0 },
    });
    expect(state.activePane).toBe("right");
  });

  it("places a read-only caret, clamped, and makes that pane active", () => {
    useDiffStore.getState().placeCaret("left", { line: 40, col: 99 });
    const state = useDiffStore.getState();
    expect(state.readOnlyCarets.left).toEqual({ line: 12, col: 1 });
    expect(state.activePane).toBe("left");
  });

  it("routes a placement on the editable side to the editor's caret", () => {
    useDiffStore.getState().placeCaret("left", { line: 2, col: 0 });
    useDiffStore.getState().placeCaret("right", { line: 10, col: 1 });
    const state = useDiffStore.getState();
    expect(state.cursor?.head).toEqual({ line: 10, col: 1 });
    expect(state.readOnlyCarets.right).toBeNull();
    expect(state.activePane).toBe("right");
  });

  it("expands the fold a read-only caret would otherwise hide inside", () => {
    expect(useDiffStore.getState().folds.length).toBe(1);
    useDiffStore.getState().placeCaret("left", { line: 2, col: 0 });
    expect(useDiffStore.getState().folds.length).toBe(0);
  });

  it("starts every caret over on the first change after Swap Sides", () => {
    useDiffStore.getState().placeCaret("left", { line: 1, col: 1 });
    useDiffStore.getState().swapSides();
    const state = useDiffStore.getState();
    expect(caretOn(state, "left")).toEqual({ line: 8, col: 0 });
    expect(caretOn(state, "right")).toEqual({ line: 8, col: 0 });
    expect(state.activePane).toBe("left");
  });

  it("carries no caret for a placeholder diff", () => {
    useDiffStore.getState().setSides({
      kind: "binary",
      leftBytes: 1,
      rightBytes: 2,
      differs: true,
      leftRef: "aaaa111",
      rightRef: WORKING_TREE_REF,
      ...meta,
    });
    const state = useDiffStore.getState();
    expect(state.cursor).toBeNull();
    expect(state.readOnlyCarets).toEqual({ left: null, right: null });
    expect(editSourcePosition(state)).toBeNull();
  });
});

describe("folds rebuilt under a caret that did not move", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
    });
    load(before, after);
  });

  it("keeps a read-only caret visible when the context shrinks around it", () => {
    // Three context lines leave 5, 6 and 7 on screen above the change.
    useDiffStore.getState().placeCaret("left", { line: 5, col: 0 });
    expect(hiding("left", 5)).toEqual([]);

    useDiffStore.getState().setContextLines(2);

    expect(useDiffStore.getState().readOnlyCarets.left).toEqual({
      line: 5,
      col: 0,
    });
    expect(hiding("left", 5)).toEqual([]);
  });

  it("keeps a read-only caret visible when everything is re-collapsed", () => {
    useDiffStore.getState().placeCaret("left", { line: 2, col: 0 });
    expect(useDiffStore.getState().folds).toHaveLength(0);

    useDiffStore.getState().setCollapsed(true);

    expect(useDiffStore.getState().collapseUnchanged).toBe(true);
    expect(hiding("left", 2)).toEqual([]);
  });

  it("keeps the editable cursor visible across the collapse toggle", () => {
    useDiffStore.getState().setCursor(caretAt(2, 0));
    expect(useDiffStore.getState().folds).toHaveLength(0);

    useDiffStore.getState().toggleCollapseUnchanged();
    useDiffStore.getState().toggleCollapseUnchanged();

    expect(useDiffStore.getState().collapseUnchanged).toBe(true);
    expect(useDiffStore.getState().cursor?.head).toEqual({ line: 2, col: 0 });
    expect(hiding("right", 2)).toEqual([]);
  });

  it("keeps a caret visible when a whitespace policy re-chunks the file", () => {
    // The only difference is trailing whitespace, so "trim" merges the two
    // equal runs into one long one whose fold covers more than either did.
    load(before, before.replace("old", "old  "));
    useDiffStore.getState().placeCaret("left", { line: 5, col: 0 });
    expect(hiding("left", 5)).toEqual([]);

    useDiffStore.getState().setWhitespace("trim");

    expect(useDiffStore.getState().differences).toBe(0);
    expect(hiding("left", 5)).toEqual([]);
  });
});

describe("carets placed as a diff opens", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
    });
  });

  it("opens a run that would hide the caret it just placed", () => {
    // Trailing whitespace under "trim" leaves one equal chunk covering the
    // whole file, and a chunk that is both first and last keeps no context:
    // the fold would hide every line, the caret's included.
    useDiffStore.setState({ whitespace: "trim" });
    load(before, before.replace("old", "old  "));

    const state = useDiffStore.getState();
    expect(state.differences).toBe(0);
    expect(caretOn(state, "left")).toEqual({ line: 0, col: 0 });
    expect(hiding("left", 0)).toEqual([]);
    expect(hiding("right", 0)).toEqual([]);
  });

  it("opens a run that would hide the caret Swap Sides re-places", () => {
    useDiffStore.setState({ whitespace: "trim" });
    load(before, before.replace("old", "old  "));
    useDiffStore.getState().swapSides();

    const state = useDiffStore.getState();
    expect(state.swapped).toBe(true);
    expect(caretOn(state, "left")).toEqual({ line: 0, col: 0 });
    expect(hiding("left", 0)).toEqual([]);
  });

  it("still collapses the runs no caret sits in", () => {
    // The ordinary case: the carets open on the change, and the long
    // unchanged run above them stays folded.
    load(before, after);
    expect(useDiffStore.getState().folds).toHaveLength(1);
    expect(hiding("left", 8)).toEqual([]);
  });
});

describe("a reload of the same document", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
      activeChunk: -1,
    });
    load(before, after);
  });

  it("leaves every caret where the reader put it", () => {
    useDiffStore.getState().placeCaret("left", { line: 12, col: 1 });
    useDiffStore.getState().setCursor({
      anchor: { line: 11, col: 1 },
      head: { line: 11, col: 1 },
    });
    // The same file, rewritten on disk under a clean diff.
    load(before, after.replace("new", "newer"));

    const state = useDiffStore.getState();
    expect(state.readOnlyCarets.left).toEqual({ line: 12, col: 1 });
    expect(state.cursor?.head).toEqual({ line: 11, col: 1 });
    expect(state.activePane).toBe("right");
  });

  it("clamps a kept caret into the text that arrived", () => {
    useDiffStore.getState().placeCaret("left", { line: 12, col: 1 });
    load(lines("a", "b"), after);
    expect(useDiffStore.getState().readOnlyCarets.left).toEqual({
      line: 1,
      col: 1,
    });
  });

  it("starts the carets over when another file opens", () => {
    useDiffStore.getState().placeCaret("left", { line: 12, col: 1 });
    useDiffStore.getState().setSides({
      kind: "text",
      left: before,
      right: after,
      ...meta,
      filePath: "src/other.ts",
      leftRef: "aaaa111",
      rightRef: WORKING_TREE_REF,
    });
    expect(useDiffStore.getState().readOnlyCarets.left).toEqual({
      line: 8,
      col: 0,
    });
  });

  it("starts the carets over when the refs change", () => {
    useDiffStore.getState().placeCaret("left", { line: 12, col: 1 });
    load(before, after, { leftRef: "bbbb222", rightRef: WORKING_TREE_REF });
    expect(useDiffStore.getState().readOnlyCarets.left).toEqual({
      line: 8,
      col: 0,
    });
  });

  it("keeps the runs the reader opened, so a kept caret stays visible", () => {
    useDiffStore.getState().placeCaret("left", { line: 2, col: 0 });
    expect(useDiffStore.getState().folds).toHaveLength(0);

    load(before, after.replace("new", "newer"));

    expect(useDiffStore.getState().readOnlyCarets.left).toEqual({
      line: 2,
      col: 0,
    });
    expect(useDiffStore.getState().folds).toHaveLength(0);
  });

  it("reopens a run that came back around a kept caret", () => {
    // The run is chunk 1, so its hidden span starts three lines in: an extra
    // changed line above it shifts that start, and with it the key the
    // expansion was recorded under.
    const body = Array.from({ length: 20 }, (_, i) => `body ${i}`);
    const oneHead = (side: string) =>
      lines(`head ${side}`, ...body, `tail ${side}`);
    const twoHeads = (side: string) =>
      lines(`head ${side}`, `more ${side}`, ...body, `tail ${side}`);
    load(oneHead("left"), oneHead("right"));
    useDiffStore.getState().placeCaret("left", { line: 10, col: 0 });
    expect(useDiffStore.getState().folds).toHaveLength(0);

    load(twoHeads("left"), twoHeads("right"));

    const state = useDiffStore.getState();
    expect(state.readOnlyCarets.left).toEqual({ line: 10, col: 0 });
    const hiding = state.folds.filter(
      (fold) => fold.left.start <= 10 && 10 < fold.left.start + fold.left.count,
    );
    expect(hiding).toEqual([]);
  });
});

describe("editSourcePosition", () => {
  beforeEach(() => {
    useDiffStore.setState(pristine, true);
    useDiffStore.setState({
      whitespace: "none",
      collapseUnchanged: true,
      contextLines: 3,
      swapped: false,
    });
    load(before, after);
  });

  it("hands over the editable caret as it is", () => {
    useDiffStore.getState().setCursor({
      anchor: { line: 10, col: 1 },
      head: { line: 10, col: 1 },
    });
    expect(editSourcePosition(useDiffStore.getState())).toEqual({
      line: 10,
      column: 1,
    });
  });

  it("maps a read-only caret on an equal line across exactly", () => {
    load(lines("a", "b", "old", "c"), lines("a", "b", "new", "extra", "c"));
    useDiffStore.getState().placeCaret("left", { line: 3, col: 1 });
    expect(editSourcePosition(useDiffStore.getState())).toEqual({
      line: 4,
      column: 1,
    });
  });

  it("drops the column when the caret sits inside a changed chunk", () => {
    useDiffStore.getState().placeCaret("left", { line: 8, col: 2 });
    expect(editSourcePosition(useDiffStore.getState())).toEqual({
      line: 8,
      column: 0,
    });
  });

  it("uses the active pane, whichever was touched last", () => {
    useDiffStore.getState().placeCaret("left", { line: 1, col: 1 });
    useDiffStore.getState().setCursor({
      anchor: { line: 11, col: 0 },
      head: { line: 11, col: 0 },
    });
    expect(editSourcePosition(useDiffStore.getState())).toEqual({
      line: 11,
      column: 0,
    });
  });

  it("passes a caret through untouched when no side is the working tree", () => {
    load(before, after, { leftRef: "aaaa111", rightRef: "bbbb222" });
    useDiffStore.getState().placeCaret("left", { line: 3, col: 1 });
    expect(editSourcePosition(useDiffStore.getState())).toEqual({
      line: 3,
      column: 1,
    });
  });
});
