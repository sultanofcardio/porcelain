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
    useDiffStore.getState().markSaved("a\nedited\nc\n");
    const state = useDiffStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.savedText).toBe("a\nedited\nc\n");
    // Undoing past a save is dirty again relative to the new baseline.
    useDiffStore.getState().undoEdit();
    expect(useDiffStore.getState().dirty).toBe(true);
  });

  it("baselines what was written, so edits during a save stay dirty", () => {
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["edited"]);
    // The save captured "edited"; more typing lands while the write is in
    // flight. When it resolves, the newer edit must still count as unsaved.
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["newer"]);
    useDiffStore.getState().markSaved("a\nedited\nc\n");
    const state = useDiffStore.getState();
    expect(state.savedText).toBe("a\nedited\nc\n");
    expect(state.dirty).toBe(true);
  });

  it("swapping sides commits an open island instead of misdirecting it", () => {
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().islandLinesChanged(["typed", "typed2"]);
    useDiffStore.getState().swapSides();
    const state = useDiffStore.getState();
    expect(state.island).toBeNull();
    // The edited text swapped to the left with its ref; nothing was lost.
    expect(state.leftRef).toBe(WORKING_TREE_REF);
    expect(state.left).toBe("a\ntyped\ntyped2\nc\n");
    expect(state.dirty).toBe(true);
  });

  it("a splice above the stepped match keeps the walk on the same hit", () => {
    loadWorkingTreeDiff("a\nold\nb\nhit\nhit\n", "a\nnew\nb\nhit\nhit\n");
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "hit");
    useDiffStore.getState().stepMatch("right", 1);
    expect(useDiffStore.getState().findRight.activeMatch).toBe(1);

    // Growing the island above both matches shifts them down one line; the
    // active match must follow its own hit, not lock onto the first
    // occurrence that now sits at the old line number.
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["new1", "new2"]);
    const after = useDiffStore.getState().findRight;
    expect(after.activeMatch).toBe(1);
    expect(after.matches[after.activeMatch].line).toBe(5);
  });

  it("opening an island expands any fold hiding part of its range", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    loadWorkingTreeDiff(`old\n${body}\n`, `new\n${body}\n`);
    expect(useDiffStore.getState().folds).toHaveLength(1);
    // Line 2 is visible context, but the island's window reaches into the
    // collapsed run — editing hidden lines through an overlay is not on.
    useDiffStore.getState().openIsland(2);
    const state = useDiffStore.getState();
    expect(state.island).not.toBeNull();
    expect(state.folds).toHaveLength(0);
    expect(state.expandedFolds.size).toBeGreaterThan(0);
  });

  it("an expanded fold stays expanded across a splice above it", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    // The working tree sits on the left so the splice moves the fold keys,
    // which are left start lines.
    useDiffStore.getState().setSides({
      kind: "text",
      left: `new\n${body}\nz\n`,
      right: `old\n${body}\nz\n`,
      filePath: "src/a.ts",
      leftRef: WORKING_TREE_REF,
      rightRef: "HEAD",
      leftLabel: "Working tree",
      rightLabel: "HEAD",
      language: "typescript",
    });
    const fold = useDiffStore.getState().folds[0];
    expect(fold).toBeDefined();
    useDiffStore.getState().toggleFold(fold.left.start);
    expect(useDiffStore.getState().folds).toHaveLength(0);

    // Growing the first line into two shifts the fold's left start; the
    // expansion key must shift with it or the fold snaps shut mid-edit.
    useDiffStore.getState().openIsland(0);
    useDiffStore.getState().commitIsland(["new1", "new2"]);
    expect(useDiffStore.getState().folds).toHaveLength(0);
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

  it("a splice preserves the find walk and never bumps the reveal", () => {
    loadWorkingTreeDiff("hit\nold\nhit\n", "hit\nnew\nhit\n");
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "hit");
    const typed = useDiffStore.getState().findRight;
    expect(typed.matches).toHaveLength(2);

    // An edit below the active match: it relocates, and nothing scrolls.
    useDiffStore.getState().openIsland(1);
    useDiffStore.getState().commitIsland(["edited", "extra"]);
    const after = useDiffStore.getState().findRight;
    expect(after.matches.map((m) => m.line)).toEqual([0, 3]);
    expect(after.activeMatch).toBe(0);
    expect(after.revealSeq).toBe(typed.revealSeq);
  });

  it("stepping onto the same single match still bumps the reveal", () => {
    loadWorkingTreeDiff("one hit\n", "one hit\n");
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "hit");
    const before = useDiffStore.getState().findRight.revealSeq;
    useDiffStore.getState().stepMatch("right", 1);
    const state = useDiffStore.getState().findRight;
    expect(state.activeMatch).toBe(0);
    expect(state.revealSeq).toBe(before + 1);
  });
});
