import { beforeEach, describe, expect, it } from "vitest";
import { caretAt } from "../../diff/editor/editor-model";
import { WORKING_TREE_REF } from "../../shared/bridge/types";
import { editableSide, useDiffStore } from "../../shared/store/diff-store";

/**
 * The diff surface's editing story: the working-tree side owns a buffer
 * edited through the same editor core as the merge result — a cursor, free
 * edits, one coalescing history — and the EOF newline survives every splice.
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

describe("diff store editing", () => {
  beforeEach(() => loadWorkingTreeDiff("a\nold\nc\n", "a\nnew\nc\n"));

  it("derives which side is editable from the refs, not from state", () => {
    expect(editableSide(useDiffStore.getState())).toBe("right");
    expect(editableSide({ leftRef: "HEAD", rightRef: "abc123" })).toBeNull();
    expect(editableSide({ leftRef: WORKING_TREE_REF, rightRef: "HEAD" })).toBe(
      "left",
    );
  });

  it("edits splice the working-tree text and re-derive everything", () => {
    useDiffStore.getState().setCursor(caretAt(1, 3));
    useDiffStore
      .getState()
      .editAt(
        { anchor: { line: 1, col: 0 }, head: { line: 1, col: 3 } },
        "edited\nlines",
        "type",
      );
    const state = useDiffStore.getState();
    expect(state.right).toBe("a\nedited\nlines\nc\n");
    expect(state.dirty).toBe(true);
    expect(state.cursor?.head).toEqual({ line: 2, col: 5 });
    // The re-derive kept every positional structure in step.
    expect(state.chunks.some((chunk) => chunk.kind !== "equal")).toBe(true);
    expect(state.activeChunk).toBe(-1);
  });

  it("preserves a missing EOF newline through edits", () => {
    loadWorkingTreeDiff("a\nb", "a\nb");
    useDiffStore.getState().editAt(caretAt(1, 1), "!", "type");
    expect(useDiffStore.getState().right).toBe("a\nb!");
  });

  it("a typing run is one undo step, and redo brings it back", () => {
    useDiffStore.getState().editAt(caretAt(1, 3), "x", "type");
    useDiffStore.getState().editAt(caretAt(1, 4), "y", "type");
    expect(useDiffStore.getState().right).toBe("a\nnewxy\nc\n");
    useDiffStore.getState().undo();
    const undone = useDiffStore.getState();
    expect(undone.right).toBe("a\nnew\nc\n");
    expect(undone.dirty).toBe(false);
    expect(undone.canRedo).toBe(true);
    useDiffStore.getState().redo();
    expect(useDiffStore.getState().right).toBe("a\nnewxy\nc\n");
  });

  it("a no-op edit records no history and dirties nothing", () => {
    useDiffStore.getState().editAt(caretAt(1, 0), "", "type");
    const state = useDiffStore.getState();
    expect(state.canUndo).toBe(false);
    expect(state.dirty).toBe(false);
  });

  it("marks saved as the new baseline for dirty", () => {
    useDiffStore.getState().editAt(caretAt(1, 3), "!", "type");
    const written = useDiffStore.getState().right;
    useDiffStore.getState().markSaved(written);
    expect(useDiffStore.getState().dirty).toBe(false);
    expect(useDiffStore.getState().savedText).toBe(written);
    // Undoing past a save is dirty again relative to the new baseline.
    useDiffStore.getState().undo();
    expect(useDiffStore.getState().dirty).toBe(true);
  });

  it("refuses to edit a read-only surface", () => {
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
    useDiffStore.getState().setCursor(caretAt(0, 0));
    expect(useDiffStore.getState().cursor).toBeNull();
    useDiffStore.getState().editAt(caretAt(0, 0), "x", "type");
    expect(useDiffStore.getState().right).toBe("b\n");
  });

  it("a composition session is one lazy history step; cancelled leaves none", () => {
    useDiffStore.getState().setCursor(caretAt(1, 3));
    useDiffStore.getState().beginComposition();
    // Cancelled before producing anything: no step, no dirt.
    useDiffStore.getState().endComposition("");
    expect(useDiffStore.getState().canUndo).toBe(false);
    expect(useDiffStore.getState().dirty).toBe(false);

    useDiffStore.getState().beginComposition();
    useDiffStore.getState().updateComposition("に");
    useDiffStore.getState().endComposition("日本");
    const state = useDiffStore.getState();
    expect(state.right).toBe("a\nnew日本\nc\n");
    expect(state.composition).toBeNull();
    useDiffStore.getState().undo();
    expect(useDiffStore.getState().right).toBe("a\nnew\nc\n");
  });

  it("placing the caret in a collapsed run expands its fold", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    loadWorkingTreeDiff(`old\n${body}\n`, `new\n${body}\n`);
    const fold = useDiffStore.getState().folds[0];
    expect(fold).toBeDefined();
    useDiffStore.getState().setCursor(caretAt(fold.right.start + 2, 0));
    const state = useDiffStore.getState();
    expect(state.cursor?.head.line).toBe(fold.right.start + 2);
    expect(state.folds).toHaveLength(0);
  });

  it("an expanded fold stays expanded across an edit above it", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    loadWorkingTreeDiff(`old\n${body}\n`, `new\n${body}\n`);
    const fold = useDiffStore.getState().folds[0];
    useDiffStore.getState().toggleFold(fold.left.start);
    expect(useDiffStore.getState().folds).toHaveLength(0);
    // Insert a line at the top of the editable (right) side; the fold's
    // left-keyed expansion is untouched by right-side splices.
    useDiffStore.getState().editAt(caretAt(0, 3), "\nadded", null);
    expect(useDiffStore.getState().folds).toHaveLength(0);
  });

  it("swapping sides drops the cursor rather than misdirecting it", () => {
    useDiffStore.getState().setCursor(caretAt(1, 2));
    useDiffStore.getState().swapSides();
    const state = useDiffStore.getState();
    expect(state.cursor).toBeNull();
    expect(editableSide(state)).toBe("left");
  });

  it("keeps find matches honest across an edit", () => {
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "new");
    expect(useDiffStore.getState().findRight.matches).toHaveLength(1);
    useDiffStore
      .getState()
      .editAt(
        { anchor: { line: 1, col: 0 }, head: { line: 1, col: 3 } },
        "renewed\nnewer",
        null,
      );
    expect(useDiffStore.getState().findRight.matches).toHaveLength(2);
  });

  it("a splice preserves the find walk and never bumps the reveal", () => {
    loadWorkingTreeDiff("hit\nold\nhit\n", "hit\nnew\nhit\n");
    useDiffStore.getState().openFind();
    useDiffStore.getState().setFindQuery("right", "hit");
    const typed = useDiffStore.getState().findRight;
    expect(typed.matches).toHaveLength(2);

    // An edit below the active match: it relocates, and nothing scrolls.
    useDiffStore.getState().editAt(caretAt(1, 3), "\nextra", null);
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
