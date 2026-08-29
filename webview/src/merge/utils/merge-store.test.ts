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
    expect(island).toEqual({ start: 1, lines: ["b"] });
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
});
