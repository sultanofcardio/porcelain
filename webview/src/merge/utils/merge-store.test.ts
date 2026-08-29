import { beforeEach, describe, expect, it } from "vitest";
import { caretAt } from "../../diff/editor/editor-model";
import type { FileVersionsResult } from "../../shared/bridge/types";
import { useMergeStore } from "../../shared/store/merge-store";

const META = {
  filePath: "src/db/pool.ts",
  language: "typescript",
  mergeMsg: "Merge branch 'fix/pool-leak'",
  oursLabel: "main",
  theirsLabel: "fix/pool-leak",
};

function textVersions(
  base: string,
  ours: string,
  theirs: string,
): FileVersionsResult {
  return { kind: "text", base, ours, theirs, ...META };
}

/** A one-conflict merge: ours and theirs disagree about line 2. */
function loadConflict() {
  useMergeStore
    .getState()
    .load(textVersions("a\nb\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n"));
}

describe("merge store", () => {
  beforeEach(() => {
    useMergeStore.setState({ findOpen: false });
    loadConflict();
  });

  it("loads into a base-holding buffer with one pending conflict", () => {
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "b", "c"]);
    expect(state.conflictTotal).toBe(1);
    expect(state.conflictResolved).toBe(0);
    expect(state.allResolved).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.oursLabel).toBe("main");
    expect(state.theirsLabel).toBe("fix/pool-leak");
    // Two live pair diffs, derived and ready.
    expect(state.chunksOurs.length).toBeGreaterThan(0);
    expect(state.chunksTheirs.length).toBeGreaterThan(0);
    expect(state.axis.length).toBeGreaterThan(0);
  });

  it("accept splices, resolves, counts, and arms Apply", () => {
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "theirs" });
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "THEIRS", "c"]);
    expect(state.conflictResolved).toBe(1);
    expect(state.allResolved).toBe(true);
    expect(state.dirty).toBe(true);
    expect(state.resultKinds.get(1)).toBe("resolved");
  });

  it("undo restores the exact pre-decision buffer and regions", () => {
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    expect(useMergeStore.getState().result.lines).toEqual(["a", "OURS", "c"]);
    useMergeStore.getState().undo();
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "b", "c"]);
    expect(state.allResolved).toBe(false);
    expect(state.dirty).toBe(false);
  });

  it("typing over the conflict line edits and resolves it in place", () => {
    // Select the whole conflict line and type a replacement — the editor's
    // path, no modes involved.
    useMergeStore.getState().setCursor({
      anchor: { line: 1, col: 0 },
      head: { line: 1, col: 1 },
    });
    useMergeStore
      .getState()
      .editAt(
        { anchor: { line: 1, col: 0 }, head: { line: 1, col: 1 } },
        "typed by hand",
        "type",
      );
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "typed by hand", "c"]);
    expect(state.regions[0].edited).toBe(true);
    expect(state.allResolved).toBe(true);
    expect(state.resultKinds.get(1)).toBe("resolved");
    expect(state.cursor?.head).toEqual({ line: 1, col: 13 });
  });

  it("a typing run is one undo step, and redo brings it back", () => {
    useMergeStore.getState().setCursor(caretAt(1, 1));
    useMergeStore.getState().editAt(caretAt(1, 1), "x", "type");
    useMergeStore.getState().editAt(caretAt(1, 2), "y", "type");
    expect(useMergeStore.getState().result.lines[1]).toBe("bxy");
    useMergeStore.getState().undo();
    const undone = useMergeStore.getState();
    expect(undone.result.lines).toEqual(["a", "b", "c"]);
    expect(undone.dirty).toBe(false);
    expect(undone.canRedo).toBe(true);
    useMergeStore.getState().redo();
    expect(useMergeStore.getState().result.lines[1]).toBe("bxy");
  });

  it("newline edits grow the buffer, the axis, and every region below", () => {
    const before = useMergeStore.getState().axis.length;
    useMergeStore.getState().editAt(caretAt(1, 1), "1\n2", null);
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "b1", "2", "c"]);
    expect(state.axis.length).toBeGreaterThan(before);
    expect(state.regions[0].edited).toBe(true);
    expect(state.cursor?.head).toEqual({ line: 2, col: 1 });
  });

  it("a composition session is one history step and lands as typed text", () => {
    useMergeStore.getState().setCursor(caretAt(1, 1));
    useMergeStore.getState().beginComposition();
    useMergeStore.getState().updateComposition("に");
    useMergeStore.getState().updateComposition("にほ");
    expect(useMergeStore.getState().result.lines[1]).toBe("bにほ");
    expect(useMergeStore.getState().composition).not.toBeNull();
    useMergeStore.getState().endComposition("日本");
    const state = useMergeStore.getState();
    expect(state.composition).toBeNull();
    expect(state.result.lines[1]).toBe("b日本");
    useMergeStore.getState().undo();
    expect(useMergeStore.getState().result.lines).toEqual(["a", "b", "c"]);
  });

  it("a cancelled empty composition is a true no-op", () => {
    useMergeStore.getState().setCursor(caretAt(1, 1));
    useMergeStore.getState().beginComposition();
    useMergeStore.getState().endComposition("");
    const state = useMergeStore.getState();
    expect(state.composition).toBeNull();
    expect(state.result.lines).toEqual(["a", "b", "c"]);
    expect(state.regions[0].edited).toBe(false);
    expect(state.allResolved).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(false);
  });

  it("the cursor head cannot move under an open composition", () => {
    useMergeStore.getState().setCursor(caretAt(1, 1));
    useMergeStore.getState().beginComposition();
    useMergeStore.getState().setCursor(caretAt(0, 0));
    expect(useMergeStore.getState().cursor?.head).toEqual({ line: 1, col: 1 });
    useMergeStore.getState().updateComposition("に");
    expect(useMergeStore.getState().result.lines[1]).toBe("bに");
  });

  it("steps through pending conflicts, wrapping", () => {
    useMergeStore
      .getState()
      .load(
        textVersions(
          "a\nb\nc\nd\ne\n",
          "a\nO1\nc\nO2\ne\n",
          "a\nT1\nc\nT2\ne\n",
        ),
      );
    useMergeStore.getState().stepConflict(1);
    expect(useMergeStore.getState().activeRegion).toBe(0);
    useMergeStore.getState().stepConflict(1);
    expect(useMergeStore.getState().activeRegion).toBe(1);
    useMergeStore.getState().stepConflict(1);
    expect(useMergeStore.getState().activeRegion).toBe(0);
    expect(useMergeStore.getState().activeRegionAxis()).not.toBeNull();
  });

  it("finds per pane and answers with an axis position", () => {
    useMergeStore.getState().openFind();
    useMergeStore.getState().setFindQuery("result", "b");
    const state = useMergeStore.getState();
    expect(state.findPanes.result.matches).toHaveLength(1);
    expect(state.findPanes.ours.matches).toHaveLength(0);
    expect(state.activeMatchAxis("result")).not.toBeNull();
  });

  it("preserves the EOF newline through to what Apply writes", () => {
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    expect(useMergeStore.getState().mergedText()).toBe("a\nOURS\nc\n");

    useMergeStore.getState().load(textVersions("a\nb", "a\nOURS", "a\nTHEIRS"));
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "theirs" });
    expect(useMergeStore.getState().mergedText()).toBe("a\nTHEIRS");
  });

  it("carries a non-text classification as the fallback", () => {
    useMergeStore.getState().load({ kind: "binary", bytes: 2048, ...META });
    const state = useMergeStore.getState();
    expect(state.fallback).toMatchObject({ kind: "binary", bytes: 2048 });
    expect(state.conflictTotal).toBe(0);
    expect(state.result.lines).toEqual([]);
  });

  describe("empty-base slots", () => {
    const loadSlot = () =>
      useMergeStore
        .getState()
        .load(
          textVersions(
            "a\nc\n",
            "a\nshared\nmine\nc\n",
            "a\nshared\nyours\nc\n",
          ),
        );

    it("the ✎ verb gives the slot a line to type on, one undo step away", () => {
      loadSlot();
      expect(useMergeStore.getState().regions[0]).toMatchObject({
        start: 1,
        count: 0,
      });
      useMergeStore.getState().editRegionByHand(0);
      const opened = useMergeStore.getState();
      // The inserted line belongs to the region — the neighbour below moved
      // down intact, nothing was eaten.
      expect(opened.result.lines).toEqual(["a", "", "c"]);
      expect(opened.regions[0]).toMatchObject({
        start: 1,
        count: 1,
        edited: true,
      });
      expect(opened.cursor?.head).toEqual({ line: 1, col: 0 });
      expect(opened.allResolved).toBe(true);
      // Undo takes the whole gesture back to a pending empty slot.
      useMergeStore.getState().undo();
      const undone = useMergeStore.getState();
      expect(undone.result.lines).toEqual(["a", "c"]);
      expect(undone.regions[0]).toMatchObject({ start: 1, count: 0 });
      expect(undone.allResolved).toBe(false);
    });

    it("the ✎ verb on an EOF slot appends its line — never splits the last", () => {
      // Both sides appended past the base: the slot sits at EOF, one past
      // the last buffer line, where a clamped edit would split "a" instead.
      useMergeStore.getState().load(textVersions("a\n", "a\nX\n", "a\nY\n"));
      expect(useMergeStore.getState().regions[0]).toMatchObject({
        start: 1,
        count: 0,
      });
      useMergeStore.getState().editRegionByHand(0);
      const opened = useMergeStore.getState();
      expect(opened.result.lines).toEqual(["a", ""]);
      expect(opened.regions[0]).toMatchObject({
        start: 1,
        count: 1,
        edited: true,
      });
      expect(opened.cursor?.head).toEqual({ line: 1, col: 0 });
      useMergeStore.getState().undo();
      const undone = useMergeStore.getState();
      expect(undone.result.lines).toEqual(["a"]);
      expect(undone.regions[0]).toMatchObject({ start: 1, count: 0 });
      expect(undone.allResolved).toBe(false);
    });

    it("typing on the slot's line fills the conflict without eating the neighbour", () => {
      loadSlot();
      useMergeStore.getState().editRegionByHand(0);
      useMergeStore.getState().editAt(caretAt(1, 0), "typed", "type");
      const state = useMergeStore.getState();
      expect(state.result.lines).toEqual(["a", "typed", "c"]);
      expect(state.regions[0].edited).toBe(true);
      expect(state.allResolved).toBe(true);
    });
  });

  it("an edit at the seam of an empty slot neither moves nor resolves it", () => {
    useMergeStore
      .getState()
      .load(
        textVersions("a\nc\n", "a\nshared\nmine\nc\n", "a\nshared\nyours\nc\n"),
      );
    // Edit the line the slot sits before ("c", line 1) — aimed at
    // neighbouring text, not at the conflict.
    useMergeStore.getState().editAt(caretAt(1, 1), "!", "type");
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "c!"]);
    expect(state.regions[0]).toMatchObject({
      start: 1,
      count: 0,
      edited: false,
    });
    expect(state.allResolved).toBe(false);
  });

  it("accepting a flank that deleted the base drops the lines from the merge", () => {
    useMergeStore
      .getState()
      .load(textVersions("a\nb\nc\n", "a\nc\n", "a\nB\nc\n"));
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "c"]);
    expect(state.allResolved).toBe(true);
    expect(state.mergedText()).toBe("a\nc\n");
  });

  it("a splice above the stepped match keeps the walk on the same hit", () => {
    useMergeStore
      .getState()
      .load(
        textVersions(
          "a\nb\nhit\nhit\n",
          "a\nO1\nO2\nhit\nhit\n",
          "a\nT\nhit\nhit\n",
        ),
      );
    useMergeStore.getState().openFind();
    useMergeStore.getState().setFindQuery("result", "hit");
    useMergeStore.getState().stepMatch("result", 1);
    expect(useMergeStore.getState().findPanes.result.activeMatch).toBe(1);

    // Accepting ours splices one base line into two above both matches: the
    // active match must follow its own hit down, not lock onto the first
    // occurrence that now sits at the old line number.
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    const after = useMergeStore.getState().findPanes.result;
    expect(after.activeMatch).toBe(1);
    expect(after.matches[after.activeMatch].line).toBe(4);
  });

  it("an expanded fold stays expanded across an accept above it", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`);
    useMergeStore
      .getState()
      .load(
        textVersions(
          `b\n${body.join("\n")}\n`,
          `O1\nO2\n${body.join("\n")}\n`,
          `T\n${body.join("\n")}\n`,
        ),
      );
    const fold = useMergeStore.getState().folds.pairO[0];
    expect(fold).toBeDefined();
    useMergeStore.getState().toggleFold(fold.right.start);
    expect(useMergeStore.getState().folds.pairO).toHaveLength(0);

    // The accept splices one line into two above the fold; its key must
    // shift with the buffer or the fold snaps shut again.
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    expect(useMergeStore.getState().folds.pairO).toHaveLength(0);
  });

  it("placing the caret inside a collapsed run expands its fold", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`);
    useMergeStore
      .getState()
      .load(
        textVersions(
          `b\n${body.join("\n")}\n`,
          `O\n${body.join("\n")}\n`,
          `T\n${body.join("\n")}\n`,
        ),
      );
    const fold = useMergeStore.getState().folds.pairO[0];
    expect(fold).toBeDefined();
    // A caret must never sit on hidden content: setting it into the run
    // expands the fold, so what the user edits is what they see.
    useMergeStore.getState().setCursor(caretAt(fold.right.start + 2, 0));
    const state = useMergeStore.getState();
    expect(state.cursor?.head.line).toBe(fold.right.start + 2);
    expect(state.folds.pairO).toHaveLength(0);
  });

  it("a splice keeps the stepped find match and never fires the reveal", () => {
    useMergeStore
      .getState()
      .load(
        textVersions(
          "hit\nb\nhit\nd\ne\n",
          "hit\nb\nhit\nOURS\ne\n",
          "hit\nb\nhit\nTHEIRS\ne\n",
        ),
      );
    useMergeStore.getState().openFind();
    useMergeStore.getState().setFindQuery("result", "hit");
    useMergeStore.getState().stepMatch("result", 1);
    const before = useMergeStore.getState().findPanes.result;
    expect(before.activeMatch).toBe(1);
    expect(before.matches[1].line).toBe(2);

    // The splice happens below both matches: the walk must survive it, and
    // the reveal sequence — what scrolls the viewport — must not budge.
    useMergeStore
      .getState()
      .decideRegion(0, { action: "accept", side: "ours" });
    const after = useMergeStore.getState().findPanes.result;
    expect(after.activeMatch).toBe(1);
    expect(after.matches[after.activeMatch].line).toBe(2);
    expect(after.revealSeq).toBe(before.revealSeq);
  });
});
