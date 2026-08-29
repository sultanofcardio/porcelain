import { beforeEach, describe, expect, it } from "vitest";
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

  it("an island over the conflict commits as a manual resolution", () => {
    useMergeStore.getState().openIsland(1);
    const island = useMergeStore.getState().island;
    expect(island).toEqual({
      start: 1,
      count: 1,
      lines: ["b"],
      zeroBase: false,
    });
    useMergeStore.getState().commitIsland(["typed by hand"]);
    const state = useMergeStore.getState();
    expect(state.island).toBeNull();
    expect(state.result.lines).toEqual(["a", "typed by hand", "c"]);
    expect(state.regions[0].edited).toBe(true);
    expect(state.allResolved).toBe(true);
    expect(state.resultKinds.get(1)).toBe("resolved");
  });

  it("a commit that changed nothing leaves no history and no dirt", () => {
    useMergeStore.getState().openIsland(1);
    useMergeStore.getState().commitIsland(["b"]);
    const state = useMergeStore.getState();
    expect(state.undoStack).toHaveLength(0);
    expect(state.dirty).toBe(false);
    expect(state.regions[0].edited).toBe(false);
  });

  it("live line-count changes grow the buffer and the axis while typing", () => {
    useMergeStore.getState().openIsland(1);
    const before = useMergeStore.getState().axis.length;
    useMergeStore.getState().islandLinesChanged(["b", "b2", "b3"]);
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "b", "b2", "b3", "c"]);
    expect(state.axis.length).toBeGreaterThan(before);
    expect(state.island?.lines).toEqual(["b", "b2", "b3"]);
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

    it("opening the editor and escaping leaves the buffer untouched", () => {
      loadSlot();
      expect(useMergeStore.getState().regions[0]).toMatchObject({
        start: 2,
        count: 0,
      });
      useMergeStore.getState().openIslandForRegion(0);
      expect(useMergeStore.getState().island).toMatchObject({
        start: 2,
        count: 0,
        lines: [""],
        zeroBase: true,
      });
      // The textarea's padding line is visual only: committing it must not
      // eat the real line below the slot.
      useMergeStore.getState().commitIsland([""]);
      const state = useMergeStore.getState();
      expect(state.result.lines).toEqual(["a", "shared", "c"]);
      expect(state.regions[0].edited).toBe(false);
      expect(state.dirty).toBe(false);
      expect(state.undoStack).toHaveLength(0);
    });

    it("typing into the slot inserts without eating the neighbour", () => {
      loadSlot();
      useMergeStore.getState().openIslandForRegion(0);
      useMergeStore.getState().commitIsland(["typed"]);
      const state = useMergeStore.getState();
      expect(state.result.lines).toEqual(["a", "shared", "typed", "c"]);
      expect(state.regions[0].edited).toBe(true);
      expect(state.allResolved).toBe(true);
    });
  });

  it("an island session that ends where it started rolls fully back", () => {
    useMergeStore.getState().openIsland(1);
    // A live count change resolves the region mid-session…
    useMergeStore.getState().islandLinesChanged(["b", "x"]);
    expect(useMergeStore.getState().regions[0].edited).toBe(true);
    // …but ending back at the original content must undo all of it, or a
    // pending conflict stays silently resolved-as-base with its undo point
    // discarded.
    useMergeStore.getState().commitIsland(["b"]);
    const state = useMergeStore.getState();
    expect(state.result.lines).toEqual(["a", "b", "c"]);
    expect(state.regions[0].edited).toBe(false);
    expect(state.allResolved).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
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
