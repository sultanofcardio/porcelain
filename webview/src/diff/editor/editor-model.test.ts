import { describe, expect, it } from "vitest";
import {
  applyTextEdit,
  caretAt,
  clampPosition,
  colAtVisual,
  deletionRange,
  documentEnd,
  EditHistory,
  isCaret,
  moveHorizontal,
  moveVertical,
  moveWord,
  nextCol,
  ordered,
  prevCol,
  visualCol,
} from "./editor-model";

const DOC = ["const a = 1;", "", "\treturn a + b;", "🎉 emoji 🎉 line"];

describe("positions and selections", () => {
  it("orders selections by document position", () => {
    const back = { anchor: { line: 2, col: 3 }, head: { line: 1, col: 0 } };
    expect(ordered(back)).toEqual({
      start: { line: 1, col: 0 },
      end: { line: 2, col: 3 },
    });
    expect(isCaret(caretAt(1, 4))).toBe(true);
    expect(isCaret(back)).toBe(false);
  });

  it("clamps positions into the document", () => {
    expect(clampPosition(DOC, { line: 99, col: 99 })).toEqual({
      line: 3,
      col: DOC[3].length,
    });
    expect(clampPosition(DOC, { line: -1, col: -1 })).toEqual({
      line: 0,
      col: 0,
    });
    expect(clampPosition([], { line: 5, col: 5 })).toEqual({ line: 0, col: 0 });
  });
});

describe("surrogate-safe stepping", () => {
  const emoji = "a🎉b";

  it("never lands between the halves of a surrogate pair", () => {
    expect(nextCol(emoji, 1)).toBe(3); // over the pair
    expect(prevCol(emoji, 3)).toBe(1);
    expect(nextCol(emoji, 0)).toBe(1);
    expect(prevCol(emoji, 1)).toBe(0);
  });

  it("moves the caret across emoji as one character", () => {
    const lines = [emoji];
    let pos = { line: 0, col: 0 };
    pos = moveHorizontal(lines, pos, 1);
    expect(pos.col).toBe(1);
    pos = moveHorizontal(lines, pos, 1);
    expect(pos.col).toBe(3);
    pos = moveHorizontal(lines, pos, -1);
    expect(pos.col).toBe(1);
  });

  it("wraps line boundaries in both directions", () => {
    expect(moveHorizontal(DOC, { line: 1, col: 0 }, -1)).toEqual({
      line: 0,
      col: DOC[0].length,
    });
    expect(moveHorizontal(DOC, { line: 0, col: DOC[0].length }, 1)).toEqual({
      line: 1,
      col: 0,
    });
  });
});

describe("the visual coordinate", () => {
  it("expands tabs to the next stop", () => {
    expect(visualCol("\tx", 1)).toBe(8);
    expect(visualCol("\tx", 2)).toBe(9);
    expect(visualCol("ab\tx", 3)).toBe(8); // tab from cell 2 → 8
  });

  it("counts a surrogate pair as one cell", () => {
    expect(visualCol("🎉x", 2)).toBe(1);
    expect(visualCol("🎉x", 3)).toBe(2);
  });

  it("maps a visual cell back to the nearest caret column", () => {
    expect(colAtVisual("\tx", 0)).toBe(0);
    expect(colAtVisual("\tx", 7)).toBe(1); // deep inside the tab → after it
    expect(colAtVisual("\tx", 1)).toBe(0); // shallow inside → before it
    expect(colAtVisual("🎉x", 1)).toBe(2); // never inside the pair
    expect(colAtVisual("abc", 99)).toBe(3);
  });
});

describe("vertical movement", () => {
  it("keeps the visual goal column across short lines", () => {
    // Start at col 10 of line 0, cross the empty line, land on the tab line.
    const first = moveVertical(DOC, { line: 0, col: 10 }, 1, null);
    expect(first.position).toEqual({ line: 1, col: 0 });
    expect(first.goalVisual).toBe(10);
    const second = moveVertical(DOC, first.position, 1, first.goalVisual);
    // Visual 10 on "\treturn…" is column 3 ("\tre|turn").
    expect(second.position).toEqual({ line: 2, col: 3 });
  });

  it("jumps to the document edge when already on the edge line", () => {
    const up = moveVertical(DOC, { line: 0, col: 5 }, -1, null);
    expect(up.position).toEqual({ line: 0, col: 0 });
    const down = moveVertical(DOC, { line: 3, col: 0 }, 1, null);
    expect(down.position).toEqual(documentEnd(DOC));
  });
});

describe("word movement", () => {
  const line = ["foo_bar  baz-qux"];

  it("steps through one run of word characters", () => {
    expect(moveWord(line, { line: 0, col: 0 }, 1)).toEqual({
      line: 0,
      col: 7,
    });
  });

  it("skips whitespace before the next run", () => {
    expect(moveWord(line, { line: 0, col: 7 }, 1)).toEqual({
      line: 0,
      col: 12,
    });
  });

  it("treats punctuation as its own run", () => {
    expect(moveWord(line, { line: 0, col: 12 }, 1)).toEqual({
      line: 0,
      col: 13,
    });
  });

  it("moves backwards symmetrically", () => {
    expect(moveWord(line, { line: 0, col: 7 }, -1)).toEqual({
      line: 0,
      col: 0,
    });
    expect(moveWord(line, { line: 0, col: 16 }, -1)).toEqual({
      line: 0,
      col: 13,
    });
  });

  it("stops at the line boundary it crosses", () => {
    const two = ["one", "two"];
    expect(moveWord(two, { line: 0, col: 3 }, 1)).toEqual({ line: 1, col: 0 });
    expect(moveWord(two, { line: 1, col: 0 }, -1)).toEqual({
      line: 0,
      col: 3,
    });
  });
});

describe("applyTextEdit", () => {
  it("inserts at a caret", () => {
    const edit = applyTextEdit(["hello world"], caretAt(0, 5), ",");
    expect(edit.lines).toEqual(["hello, world"]);
    expect(edit.caret).toEqual({ line: 0, col: 6 });
    expect(edit.lineDelta).toBe(0);
  });

  it("replaces a multi-line selection with multi-line text", () => {
    const edit = applyTextEdit(
      ["aaa", "bbb", "ccc"],
      { anchor: { line: 0, col: 1 }, head: { line: 2, col: 2 } },
      "X\nY",
    );
    expect(edit.lines).toEqual(["aX", "Yc"]);
    expect(edit.caret).toEqual({ line: 1, col: 1 });
    expect(edit.lineDelta).toBe(-1);
    expect(edit.replaced).toEqual({
      start: { line: 0, col: 1 },
      end: { line: 2, col: 2 },
    });
  });

  it("splits a line on Enter", () => {
    const edit = applyTextEdit(["ab"], caretAt(0, 1), "\n");
    expect(edit.lines).toEqual(["a", "b"]);
    expect(edit.caret).toEqual({ line: 1, col: 0 });
    expect(edit.lineDelta).toBe(1);
  });

  it("edits an empty document as one empty line", () => {
    const edit = applyTextEdit([], caretAt(0, 0), "hi");
    expect(edit.lines).toEqual(["hi"]);
  });
});

describe("deletionRange", () => {
  it("spans one code point backwards for Backspace", () => {
    const range = deletionRange(["a🎉"], caretAt(0, 3), -1, false);
    expect(ordered(range)).toEqual({
      start: { line: 0, col: 1 },
      end: { line: 0, col: 3 },
    });
  });

  it("joins lines when deleting at a boundary", () => {
    const range = deletionRange(["ab", "cd"], caretAt(1, 0), -1, false);
    expect(ordered(range)).toEqual({
      start: { line: 0, col: 2 },
      end: { line: 1, col: 0 },
    });
  });

  it("spans a word for word-deletion", () => {
    const range = deletionRange(["foo bar"], caretAt(0, 7), -1, true);
    expect(ordered(range).start).toEqual({ line: 0, col: 4 });
  });

  it("leaves a real selection alone", () => {
    const selection = {
      anchor: { line: 0, col: 0 },
      head: { line: 0, col: 3 },
    };
    expect(deletionRange(["abcd"], selection, -1, false)).toBe(selection);
  });
});

describe("EditHistory", () => {
  const snap = (text: string) => ({
    lines: [text],
    selection: caretAt(0, text.length),
  });

  it("coalesces a typing run into one undo step", () => {
    const history = new EditHistory();
    history.record(snap(""), "type", 1000);
    history.record(snap("h"), "type", 1100);
    history.record(snap("he"), "type", 1200);
    expect(history.depth).toBe(1);
    expect(history.undo(snap("hel"))?.lines).toEqual([""]);
  });

  it("breaks the run on a pause, a different key, or null", () => {
    const history = new EditHistory();
    history.record(snap(""), "type", 1000);
    history.record(snap("h"), "type", 2000); // paused past the window
    history.record(snap("hi"), null, 2100); // structural
    history.record(snap("hi!"), "type", 2200);
    expect(history.depth).toBe(4);
  });

  it("redoes what undo took, until a new edit clears the future", () => {
    const history = new EditHistory();
    history.record(snap("one"), null, 0);
    const current = snap("two");
    const undone = history.undo(current);
    expect(undone?.lines).toEqual(["one"]);
    expect(history.canRedo).toBe(true);
    expect(history.redo(undone as never)?.lines).toEqual(["two"]);
    // A fresh edit after an undo discards the redo branch.
    history.undo(snap("two"));
    history.record(snap("one"), null, 10);
    expect(history.canRedo).toBe(false);
  });

  it("never coalesces across an undo", () => {
    const history = new EditHistory();
    history.record(snap(""), "type", 0);
    history.undo(snap("a"));
    history.record(snap(""), "type", 100);
    expect(history.depth).toBe(1);
    expect(history.canRedo).toBe(false);
  });
});
