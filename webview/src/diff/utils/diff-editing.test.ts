import { beforeEach, describe, expect, it } from "vitest";
import { WORKING_TREE_REF } from "../../shared/bridge/types";
import { editableSide, useDiffStore } from "../../shared/store/diff-store";
import { computeChunks, editRangeAt, replaceLineRange } from "./diff-model";

/**
 * The diff surface's editing story (the merge review's decision 2): the
 * working-tree side owns a buffer, islands splice into it, and the EOF
 * newline survives every splice.
 */

function loadWorkingTreeDiff(left: string, right: string) {
  useDiffStore.getState().setSides({
    kind: "text",
    left,
    right,
    filePath: "src/a.ts",
    leftRef: "HEAD",
    rightRef: WORKING_TREE_REF,
    leftLabel: "HEAD",
    rightLabel: "Working tree",
    language: "typescript",
  });
}

describe("replaceLineRange", () => {
  it("splices lines and keeps the trailing-newline state", () => {
    expect(replaceLineRange("a\nb\nc\n", 1, 1, ["B1", "B2"])).toBe(
      "a\nB1\nB2\nc\n",
    );
    expect(replaceLineRange("a\nb\nc", 1, 1, ["B"])).toBe("a\nB\nc");
    expect(replaceLineRange("a\n", 0, 1, [])).toBe("");
    expect(replaceLineRange("", 0, 0, ["x"])).toBe("x\n");
  });
});

describe("editRangeAt", () => {
  it("covers the containing changed chunk", () => {
    const chunks = computeChunks("a\nx\ny\nd\n", "a\nX\nY\nd\n");
    expect(editRangeAt(chunks, "right", 2, 4)).toEqual({ start: 1, count: 2 });
  });

  it("windows a spot edit inside a long equal run", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n");
    const chunks = computeChunks(lines, lines);
    const range = editRangeAt(chunks, "right", 50, 100);
    expect(range.start).toBe(30);
    expect(range.count).toBe(41);
  });
});

describe("diff store editing", () => {
  beforeEach(() => loadWorkingTreeDiff("a\nold\nc\n", "a\nnew\nc\n"));

  it("derives which side is editable from the refs, not from state", () => {
    expect(editableSide(useDiffStore.getState())).toBe("right");
    expect(editableSide({ leftRef: "HEAD", rightRef: "abc123" })).toBeNull();
    expect(editableSide({ leftRef: WORKING_TREE_REF, rightRef: "HEAD" })).toBe(
      "left",
    );
  });

  it("opens an island on the containing chunk and commits a splice", () => {
    useDiffStore.getState().openIsland(1);
    expect(useDiffStore.getState().island).toEqual({
      side: "right",
      start: 1,
      lines: ["new"],
    });
    useDiffStore.getState().commitIsland(["edited", "lines"]);
    const state = useDiffStore.getState();
    expect(state.island).toBeNull();
    expect(state.right).toBe("a\nedited\nlines\nc\n");
    expect(state.dirty).toBe(true);
    // The re-derive kept every positional structure in step.
    expect(state.chunks.some((chunk) => chunk.kind !== "equal")).toBe(true);
  });

  it("undoes one island as one step and lands clean again", () => {
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["edited"]);
    expect(useDiffStore.getState().dirty).toBe(true);
    useDiffStore.getState().undoEdit();
    const state = useDiffStore.getState();
    expect(state.right).toBe("a\nnew\nc\n");
    expect(state.dirty).toBe(false);
  });

  it("drops the undo snapshot of a commit that changed nothing", () => {
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["new"]);
    const state = useDiffStore.getState();
    expect(state.undoTexts).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });

  it("marks saved as the new baseline for dirty", () => {
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["edited"]);
    useDiffStore.getState().markSaved();
    const state = useDiffStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.savedText).toBe("a\nedited\nc\n");
    // Undoing past a save is dirty again relative to the new baseline.
    useDiffStore.getState().undoEdit();
    expect(useDiffStore.getState().dirty).toBe(true);
  });

  it("refuses to open an island on a read-only surface", () => {
    useDiffStore.getState().setSides({
      kind: "text",
      left: "a\n",
      right: "b\n",
      filePath: "src/a.ts",
      leftRef: "abc123",
      rightRef: "def456",
      leftLabel: "abc123",
      rightLabel: "def456",
      language: "typescript",
    });
    useDiffStore.getState().openIsland(0);
    expect(useDiffStore.getState().island).toBeNull();
  });

  it("keeps find matches honest across an edit", () => {
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "new");
    expect(useDiffStore.getState().findRight.matches).toHaveLength(1);
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["renewed", "newer"]);
    expect(useDiffStore.getState().findRight.matches).toHaveLength(2);
  });
});
