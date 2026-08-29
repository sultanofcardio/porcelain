import { describe, expect, it } from "vitest";
import { computeChunks } from "../../diff/utils/diff-model";
import {
  applyRegionDecision,
  axisToOffsets,
  buildInitialResult,
  buildMergeAxis,
  computeMergeFolds,
  flankRegionKinds,
  joinDoc,
  paneToAxis,
  regionResolved,
  remapRegionsForEdit,
  resultRegionKinds,
  splitDoc,
} from "./merge-model";

/** The two live chunk lists, the way the store derives them. */
function pairChunks(ours: string[], result: string[], theirs: string[]) {
  return {
    chunksOurs: computeChunks(ours.join("\n"), result.join("\n")),
    chunksTheirs: computeChunks(result.join("\n"), theirs.join("\n")),
  };
}

describe("splitDoc / joinDoc", () => {
  it("round-trips text with and without a trailing newline", () => {
    for (const text of ["a\nb\n", "a\nb", "", "one\n"]) {
      expect(joinDoc(splitDoc(text))).toBe(text);
    }
  });

  it("keeps the trailing-newline bit apart from the lines", () => {
    expect(splitDoc("a\nb\n")).toEqual({
      lines: ["a", "b"],
      trailingNewline: true,
    });
    expect(splitDoc("a\nb")).toEqual({
      lines: ["a", "b"],
      trailingNewline: false,
    });
  });
});

describe("buildInitialResult", () => {
  it("applies one-side changes without a region", () => {
    const { result, regions } = buildInitialResult(
      "a\nb\nc\n",
      "a\nX\nb\nc\n", // ours inserts X
      "a\nb\nY\nc\n", // theirs inserts Y elsewhere
    );
    expect(result.lines).toEqual(["a", "X", "b", "Y", "c"]);
    expect(result.trailingNewline).toBe(true);
    expect(regions).toEqual([]);
  });

  it("applies identical both-side changes once", () => {
    const { result, regions } = buildInitialResult(
      "a\nb\nc\n",
      "a\nZ\nc\n",
      "a\nZ\nc\n",
    );
    expect(result.lines).toEqual(["a", "Z", "c"]);
    expect(regions).toEqual([]);
  });

  it("keeps the base under a genuine conflict and records both slices", () => {
    const { result, regions } = buildInitialResult(
      "a\nb\nc\n",
      "a\nOURS\nc\n",
      "a\nTHEIRS\nc\n",
    );
    expect(result.lines).toEqual(["a", "b", "c"]);
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region.start).toBe(1);
    expect(region.count).toBe(1);
    expect(region.base).toEqual(["b"]);
    expect(region.ours).toEqual(["OURS"]);
    expect(region.theirs).toEqual(["THEIRS"]);
    expect(region.oursStart).toBe(1);
    expect(region.theirsStart).toBe(1);
    expect(regionResolved(region)).toBe(false);
  });

  it("refines an empty-base conflict so agreed runs are not held hostage", () => {
    const { result, regions } = buildInitialResult(
      "a\nc\n",
      "a\nshared\nmine\nc\n",
      "a\nshared\nyours\nc\n",
    );
    expect(result.lines).toEqual(["a", "shared", "c"]);
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region.start).toBe(2);
    expect(region.count).toBe(0); // an empty base renders as a slot
    expect(region.ours).toEqual(["mine"]);
    expect(region.theirs).toEqual(["yours"]);
    expect(region.oursStart).toBe(2);
    expect(region.theirsStart).toBe(2);
  });

  it("keeps a trailing newline when either input has one", () => {
    const kept = buildInitialResult("a\n", "a\nb\n", "a\n");
    expect(kept.result.trailingNewline).toBe(true);
    const dropped = buildInitialResult("a", "a\nb", "a");
    expect(dropped.result.trailingNewline).toBe(false);
  });

  // node-diff3 emits one-sided changes as *stable* regions whose content
  // length is the changed side's, and one-sided pure deletions as no region
  // at all — so flank anchors must come from the conflict region's own
  // aStart/bStart, never from accumulators walking the region list.
  it("anchors flanks correctly past a one-sided insertion", () => {
    const { regions } = buildInitialResult(
      "k\nm\nx\n",
      "k\nins\nm\nOURS\n",
      "k\nm\nTHEIRS\n",
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].ours).toEqual(["OURS"]);
    expect(regions[0].theirs).toEqual(["THEIRS"]);
    expect(regions[0].oursStart).toBe(3); // OURS in [k, ins, m, OURS]
    expect(regions[0].theirsStart).toBe(2); // THEIRS in [k, m, THEIRS]
  });

  it("anchors flanks correctly past a one-sided deletion", () => {
    const { regions } = buildInitialResult(
      "k\ndel\nm\nx\n",
      "k\nm\nOURS\n",
      "k\ndel\nm\nTHEIRS\n",
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].oursStart).toBe(2); // OURS in [k, m, OURS]
    expect(regions[0].theirsStart).toBe(3); // THEIRS in [k, del, m, THEIRS]
  });

  it("anchors refined empty-base sub-conflicts from the region's own starts", () => {
    const { regions } = buildInitialResult(
      "a\n",
      "x\na\nshared\nmine\n",
      "a\nshared\nyours\n",
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].ours).toEqual(["mine"]);
    expect(regions[0].theirs).toEqual(["yours"]);
    expect(regions[0].oursStart).toBe(3); // mine in [x, a, shared, mine]
    expect(regions[0].theirsStart).toBe(2); // yours in [a, shared, yours]
  });
});

describe("applyRegionDecision", () => {
  const load = () =>
    buildInitialResult("a\nb\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n");

  it("accept ours splices the slice in and decides theirs as ignored", () => {
    const { result, regions } = load();
    const next = applyRegionDecision(result, regions, 0, {
      action: "accept",
      side: "ours",
    });
    expect(next.buffer.lines).toEqual(["a", "OURS", "c"]);
    expect(next.regions[0].oursState).toBe("accepted");
    expect(next.regions[0].theirsState).toBe("ignored");
    expect(regionResolved(next.regions[0])).toBe(true);
  });

  it("accepting the second side puts both in, ours before theirs", () => {
    const { result, regions } = load();
    const first = applyRegionDecision(result, regions, 0, {
      action: "accept",
      side: "theirs",
    });
    const both = applyRegionDecision(first.buffer, first.regions, 0, {
      action: "accept",
      side: "ours",
    });
    expect(both.buffer.lines).toEqual(["a", "OURS", "THEIRS", "c"]);
    expect(both.regions[0].count).toBe(2);
  });

  it("ignoring both sides keeps the base and resolves", () => {
    const { result, regions } = load();
    const one = applyRegionDecision(result, regions, 0, {
      action: "ignore",
      side: "ours",
    });
    expect(regionResolved(one.regions[0])).toBe(false);
    const two = applyRegionDecision(one.buffer, one.regions, 0, {
      action: "ignore",
      side: "theirs",
    });
    expect(two.buffer.lines).toEqual(["a", "b", "c"]);
    expect(regionResolved(two.regions[0])).toBe(true);
  });

  it("revert restores the base slice and both pendings", () => {
    const { result, regions } = load();
    const accepted = applyRegionDecision(result, regions, 0, {
      action: "accept",
      side: "ours",
    });
    const reverted = applyRegionDecision(accepted.buffer, accepted.regions, 0, {
      action: "revert",
    });
    expect(reverted.buffer.lines).toEqual(["a", "b", "c"]);
    expect(reverted.regions[0].oursState).toBe("pending");
    expect(reverted.regions[0].theirsState).toBe("pending");
    expect(regionResolved(reverted.regions[0])).toBe(false);
  });

  it("remaps the regions below a splice that changes the line count", () => {
    const { result, regions } = buildInitialResult(
      "a\nb\nc\nd\ne\n",
      "a\nO1\nO2\nc\nO3\ne\n",
      "a\nT1\nc\nT2\ne\n",
    );
    expect(regions).toHaveLength(2);
    expect(regions[1].start).toBe(3);
    const next = applyRegionDecision(result, regions, 0, {
      action: "accept",
      side: "ours",
    });
    // "b" (1 line) became O1, O2 (2 lines): the second region shifts by one.
    expect(next.buffer.lines).toEqual(["a", "O1", "O2", "c", "d", "e"]);
    expect(next.regions[1].start).toBe(4);
  });
});

describe("computeMergeFolds", () => {
  const body = Array.from({ length: 30 }, (_, i) => `line${i}`);

  it("folds only where all three panes agree", () => {
    const result = [...body, "base"];
    const ours = [...body, "ours"];
    const theirs = [...body, "theirs"];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const folds = computeMergeFolds(chunksOurs, chunksTheirs, result.length);
    expect(folds.pairO).toHaveLength(1);
    expect(folds.pairT).toHaveLength(1);
    // Start of file: context only on the inner edge.
    expect(folds.pairO[0].right).toEqual({ start: 0, count: 27 });
    expect(folds.pairT[0].left).toEqual({ start: 0, count: 27 });
    expect(folds.pairO[0].hiddenLines).toBe(27);
  });

  it("does not fold a run equal in one pair only", () => {
    const result = [...body];
    const ours = [...body];
    const theirs = body.map((line, i) => (i % 2 === 0 ? line : `${line}!`));
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const folds = computeMergeFolds(chunksOurs, chunksTheirs, result.length);
    expect(folds.pairO).toEqual([]);
    expect(folds.pairT).toEqual([]);
  });

  it("emits the same hidden result run in both pair coordinate systems", () => {
    const result = ["r0", ...body, "tail"];
    const ours = ["o0", "o1", ...body, "tail"];
    const theirs = [...body, "tail"];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const folds = computeMergeFolds(chunksOurs, chunksTheirs, result.length);
    expect(folds.pairO).toHaveLength(1);
    const [foldO] = folds.pairO;
    const [foldT] = folds.pairT;
    // Result span is identical from both sides.
    expect(foldO.right).toEqual(foldT.left);
    // Flank spans carry each pair's own drift.
    expect(foldO.left.start).toBe(foldO.right.start + 1); // ours is one ahead
    expect(foldT.right.start).toBe(foldT.left.start - 1); // theirs one behind
  });

  it("keeps edge context when a flank-only change anchors at the file edge", () => {
    // The run touches result line 0, but ours removed lines just before it —
    // the 2-way viewer would keep context beside that change, and so must
    // the tri-pane folds.
    const result = [...body];
    const ours = ["extra", ...body];
    const theirs = [...body];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const folds = computeMergeFolds(chunksOurs, chunksTheirs, result.length);
    expect(folds.pairO).toHaveLength(1);
    expect(folds.pairO[0].right.start).toBe(3);
  });
});

describe("accepted deletions", () => {
  it("an accepted flank that deleted the base lines deletes them", () => {
    // ours deletes b, theirs edits it: accepting ours must not fall back to
    // the base slice just because the accepted parts are empty.
    const { result, regions } = buildInitialResult(
      "a\nb\nc\n",
      "a\nc\n",
      "a\nB\nc\n",
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].ours).toEqual([]);
    const accepted = applyRegionDecision(result, regions, 0, {
      action: "accept",
      side: "ours",
    });
    expect(accepted.buffer.lines).toEqual(["a", "c"]);
    expect(regionResolved(accepted.regions[0])).toBe(true);
  });
});

describe("buildMergeAxis", () => {
  it("is the identity when all three panes agree", () => {
    const lines = ["a", "b", "c", "d"];
    const { chunksOurs, chunksTheirs } = pairChunks(lines, lines, lines);
    const map = buildMergeAxis(lines.length, chunksOurs, chunksTheirs, {
      pairO: [],
      pairT: [],
    });
    expect(map.length).toBe(4);
    const offsets = axisToOffsets(map, 2.5);
    expect(offsets.result).toBeCloseTo(2.5);
    expect(offsets.ours).toBeCloseTo(2.5);
    expect(offsets.theirs).toBeCloseTo(2.5);
  });

  it("gives co-anchored flank extras one shared gap, max wide", () => {
    const result = ["a", "b", "c", "d"];
    const ours = ["a", "b", "o1", "o2", "c", "d"];
    const theirs = ["a", "b", "t1", "t2", "t3", "c", "d"];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const map = buildMergeAxis(result.length, chunksOurs, chunksTheirs, {
      pairO: [],
      pairT: [],
    });
    // 2 shared + max(2, 3) + 2 shared.
    expect(map.length).toBe(7);

    // One line into the gap: the result stands still, both flanks advance
    // proportionally through their own extras.
    const inGap = axisToOffsets(map, 3);
    expect(inGap.result).toBeCloseTo(2);
    expect(inGap.ours).toBeCloseTo(2 + (1 / 3) * 2);
    expect(inGap.theirs).toBeCloseTo(3);

    // Past the gap everything is in step again, shifted by each drift.
    const after = axisToOffsets(map, 5);
    expect(after.result).toBeCloseTo(2);
    expect(after.ours).toBeCloseTo(4);
    expect(after.theirs).toBeCloseTo(5);
  });

  it("widens a segment to the widest pane through it", () => {
    const result = ["a", "r1", "z"];
    const ours = ["a", "m1", "m2", "m3", "z"];
    const theirs = ["a", "r1", "z"];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const map = buildMergeAxis(result.length, chunksOurs, chunksTheirs, {
      pairO: [],
      pairT: [],
    });
    // 1 equal + max(1 result, 3 ours) + 1 equal.
    expect(map.length).toBe(5);
  });

  it("shrinks with tri-pane folds the way the 2-way axis does", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const result = [...body, "base"];
    const ours = [...body, "ours"];
    const theirs = [...body, "theirs"];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const folds = computeMergeFolds(chunksOurs, chunksTheirs, result.length);
    const map = buildMergeAxis(result.length, chunksOurs, chunksTheirs, folds);
    // 30 equal lines fold to context(3) + 1 fold row, plus the changed line.
    expect(map.length).toBe(3 + 1 + 1);
  });

  it("round-trips a result row through paneToAxis and back", () => {
    const result = ["a", "b", "c", "d", "e", "f"];
    const ours = ["a", "b", "o1", "c", "d", "e", "f"];
    const theirs = ["a", "b", "c", "d", "X", "f"];
    const { chunksOurs, chunksTheirs } = pairChunks(ours, result, theirs);
    const map = buildMergeAxis(result.length, chunksOurs, chunksTheirs, {
      pairO: [],
      pairT: [],
    });
    for (const row of [0, 1, 3, 5]) {
      const axis = paneToAxis(map, "result", row);
      expect(axisToOffsets(map, axis).result).toBeCloseTo(row);
    }
    // A flank-only row is reachable through its own pane's mapping.
    const gapAxis = paneToAxis(map, "ours", 2);
    expect(axisToOffsets(map, gapAxis).ours).toBeCloseTo(2);
  });
});

describe("presentation helpers", () => {
  it("paints pending regions as conflict and resolved ones quietly", () => {
    const { result, regions } = buildInitialResult(
      "a\nb\nc\n",
      "a\nOURS\nc\n",
      "a\nTHEIRS\nc\n",
    );
    expect(resultRegionKinds(regions).get(1)).toBe("conflict");
    const accepted = applyRegionDecision(result, regions, 0, {
      action: "accept",
      side: "ours",
    });
    expect(resultRegionKinds(accepted.regions).get(1)).toBe("resolved");
    expect(flankRegionKinds(regions, "ours").get(1)).toBe("conflict");
    expect(flankRegionKinds(regions, "theirs").get(1)).toBe("conflict");
  });
});

describe("remapRegionsForEdit", () => {
  const region = (
    start: number,
    count: number,
  ): Parameters<typeof remapRegionsForEdit>[0][number] => ({
    start,
    count,
    ours: ["o"],
    theirs: ["t"],
    base: count > 0 ? Array.from({ length: count }, () => "b") : [],
    oursStart: 0,
    theirsStart: 0,
    oursState: "pending",
    theirsState: "pending",
    edited: false,
  });

  it("an edit inside a region resolves it and adjusts its count", () => {
    const [next] = remapRegionsForEdit([region(2, 2)], 3, 3, 1);
    expect(next).toMatchObject({ start: 2, count: 3, edited: true });
  });

  it("an edit spanning a region boundary absorbs the union", () => {
    const [next] = remapRegionsForEdit([region(2, 2)], 1, 2, -1);
    expect(next).toMatchObject({ start: 1, count: 2, edited: true });
  });

  it("regions below the edit shift by the delta; above stay put", () => {
    const [above, below] = remapRegionsForEdit(
      [region(0, 1), region(6, 1)],
      3,
      3,
      2,
    );
    expect(above).toMatchObject({ start: 0, edited: false });
    expect(below).toMatchObject({ start: 8, edited: false });
  });

  it("a zero-length slot at the edit's own line neither moves nor resolves", () => {
    const [slot] = remapRegionsForEdit([region(2, 0)], 2, 2, 1);
    expect(slot).toMatchObject({ start: 2, count: 0, edited: false });
  });

  it("an edit spanning across a slot's seam resolves it", () => {
    const [slot] = remapRegionsForEdit([region(2, 0)], 1, 3, 0);
    expect(slot).toMatchObject({ edited: true });
  });
});
