import { beforeEach, describe, expect, it } from "vitest";
import { WORKING_TREE_REF } from "../../shared/bridge/types";
import {
  caretOn,
  editSourcePosition,
  useDiffStore,
} from "../../shared/store/diff-store";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

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

describe("carets on every pane", () => {
  beforeEach(() => {
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

describe("editSourcePosition", () => {
  beforeEach(() => {
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
