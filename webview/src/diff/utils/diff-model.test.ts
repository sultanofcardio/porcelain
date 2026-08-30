import { describe, expect, it } from "vitest";
import {
  axisLength,
  axisToSide,
  chooseLayout,
  chunkAxisSpan,
  computeChunks,
  computeFolds,
  connectorPath,
  countDifferences,
  type DiffChunk,
  displayLine,
  displayLineCount,
  displayToSource,
  sideToAxis,
} from "./diff-model";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

describe("computeChunks", () => {
  it("returns a single equal chunk for identical documents", () => {
    const chunks = computeChunks(lines("a", "b", "c"), lines("a", "b", "c"));
    expect(chunks).toEqual([
      {
        kind: "equal",
        left: { start: 0, count: 3 },
        right: { start: 0, count: 3 },
      },
    ]);
  });

  it("pairs a removal with the addition that replaces it", () => {
    // One edited line must be one difference, not a removal plus an addition,
    // or the toolbar count disagrees with what the eye sees.
    const chunks = computeChunks(
      lines("a", "old", "c"),
      lines("a", "new", "c"),
    );
    expect(chunks.map((c) => c.kind)).toEqual(["equal", "modified", "equal"]);
    const modified = chunks[1];
    expect(modified.left).toEqual({ start: 1, count: 1 });
    expect(modified.right).toEqual({ start: 1, count: 1 });
  });

  it("reports a pure insertion with an empty left span", () => {
    const chunks = computeChunks(lines("a", "b"), lines("a", "x", "y", "b"));
    const added = chunks.find((c) => c.kind === "added");
    expect(added?.left).toEqual({ start: 1, count: 0 });
    expect(added?.right).toEqual({ start: 1, count: 2 });
  });

  it("reports a pure deletion with an empty right span", () => {
    const chunks = computeChunks(lines("a", "x", "y", "b"), lines("a", "b"));
    const removed = chunks.find((c) => c.kind === "removed");
    expect(removed?.left).toEqual({ start: 1, count: 2 });
    expect(removed?.right).toEqual({ start: 1, count: 0 });
  });

  it("keeps both documents contiguous across every chunk", () => {
    const chunks = computeChunks(
      lines("a", "b", "c", "d", "e"),
      lines("a", "B", "c", "x", "d", "e"),
    );
    let left = 0;
    let right = 0;
    for (const chunk of chunks) {
      expect(chunk.left.start).toBe(left);
      expect(chunk.right.start).toBe(right);
      left += chunk.left.count;
      right += chunk.right.count;
    }
    expect(left).toBe(5);
    expect(right).toBe(6);
  });

  it("can treat whitespace-only differences as equal", () => {
    const left = lines("a", "  b", "c");
    const right = lines("a", "b", "c");
    expect(countDifferences(computeChunks(left, right))).toBe(1);
    expect(
      countDifferences(computeChunks(left, right, { ignoreWhitespace: true })),
    ).toBe(0);
  });

  it("handles an empty side, which is how added and deleted files diff", () => {
    expect(countDifferences(computeChunks("", lines("a", "b")))).toBe(1);
    expect(countDifferences(computeChunks(lines("a", "b"), ""))).toBe(1);
    expect(computeChunks("", "")).toEqual([]);
  });

  it("ignores a blank-line-only difference under 'ignore-empty' but not 'ignore'", () => {
    const left = lines("A", "B");
    const right = lines("A", "", "B");
    // "ignore" still reports the inserted blank as a difference...
    expect(
      countDifferences(computeChunks(left, right, { whitespace: "ignore" })),
    ).toBe(1);
    // ...while "ignore-empty" drops it entirely.
    const chunks = computeChunks(left, right, { whitespace: "ignore-empty" });
    expect(countDifferences(chunks)).toBe(0);
    // The blank still belongs to a chunk, so both documents stay tiled.
    let leftEnd = 0;
    let rightEnd = 0;
    for (const chunk of chunks) {
      expect(chunk.left.start).toBe(leftEnd);
      expect(chunk.right.start).toBe(rightEnd);
      leftEnd += chunk.left.count;
      rightEnd += chunk.right.count;
    }
    expect(leftEnd).toBe(2);
    expect(rightEnd).toBe(3);
  });

  it("still reports a real edit that sits alongside an ignored blank line", () => {
    // Right gains a blank line and edits B -> X; only the edit is a difference,
    // and it must address X at its true position (right line index 2).
    const chunks = computeChunks(lines("A", "B"), lines("A", "", "X"), {
      whitespace: "ignore-empty",
    });
    expect(countDifferences(chunks)).toBe(1);
    const edit = chunks.find((c) => c.kind !== "equal");
    expect(edit?.kind).toBe("modified");
    expect(edit?.left).toEqual({ start: 1, count: 1 });
    expect(edit?.right).toEqual({ start: 2, count: 1 });
  });
});

describe("the shared scroll axis", () => {
  // A five-line insertion after left line 2: the case every scroll frame in
  // the spec is drawn from.
  const chunks: DiffChunk[] = [
    {
      kind: "equal",
      left: { start: 0, count: 3 },
      right: { start: 0, count: 3 },
    },
    {
      kind: "added",
      left: { start: 3, count: 0 },
      right: { start: 3, count: 5 },
    },
    {
      kind: "equal",
      left: { start: 3, count: 4 },
      right: { start: 8, count: 4 },
    },
  ];

  it("gives the insertion room even though the left contributes nothing", () => {
    expect(axisLength(chunks)).toBe(12);
  });

  it("holds the left still while the right scrolls through the insertion", () => {
    // The whole point of the drift model, and the thing a direct left-to-right
    // mapping cannot express: over axis 3..8 the left does not move.
    expect(axisToSide(chunks, 3, "left")).toBe(3);
    expect(axisToSide(chunks, 5, "left")).toBe(3);
    expect(axisToSide(chunks, 8, "left")).toBe(3);

    expect(axisToSide(chunks, 3, "right")).toBe(3);
    expect(axisToSide(chunks, 5, "right")).toBe(5);
    expect(axisToSide(chunks, 8, "right")).toBe(8);
  });

  it("advances both sides together outside a change", () => {
    expect(axisToSide(chunks, 1, "left")).toBe(1);
    expect(axisToSide(chunks, 1, "right")).toBe(1);
    expect(axisToSide(chunks, 10, "left")).toBe(5);
    expect(axisToSide(chunks, 10, "right")).toBe(10);
  });

  it("leaves the sides five lines apart once the insertion is behind them", () => {
    const left = axisToSide(chunks, 11, "left");
    const right = axisToSide(chunks, 11, "right");
    expect(right - left).toBe(5);
  });

  it("moves continuously — no jump at a chunk boundary", () => {
    const rightAt = (position: number) => axisToSide(chunks, position, "right");
    for (let position = 0; position < 11; position += 0.25) {
      expect(
        Math.abs(rightAt(position + 0.25) - rightAt(position)),
      ).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it("interpolates inside an unequal chunk", () => {
    const modified: DiffChunk[] = [
      {
        kind: "modified",
        left: { start: 0, count: 2 },
        right: { start: 0, count: 6 },
      },
    ];
    expect(axisToSide(modified, 3, "left")).toBe(1);
    expect(axisToSide(modified, 3, "right")).toBe(3);
  });

  it("round-trips a line back to the axis", () => {
    expect(sideToAxis(chunks, 1, "left")).toBe(1);
    expect(sideToAxis(chunks, 5, "right")).toBe(5);
    // Left line 3 sits after the insertion, so jumping there reveals it.
    expect(sideToAxis(chunks, 3, "left")).toBe(8);
  });

  it("clamps below zero and extrapolates past the end", () => {
    expect(axisToSide(chunks, -4, "left")).toBe(0);
    expect(axisToSide(chunks, 14, "left")).toBe(9);
    expect(axisToSide([], 4, "left")).toBe(4);
    expect(sideToAxis([], 4, "left")).toBe(4);
  });
});

describe("computeFolds", () => {
  const equal = (
    leftStart: number,
    count: number,
    rightStart: number,
  ): DiffChunk => ({
    kind: "equal",
    left: { start: leftStart, count },
    right: { start: rightStart, count },
  });
  const change = (leftStart: number, rightStart: number): DiffChunk => ({
    kind: "modified",
    left: { start: leftStart, count: 1 },
    right: { start: rightStart, count: 1 },
  });

  it("leaves short unchanged runs alone", () => {
    expect(computeFolds([equal(0, 4, 0)], { contextLines: 3 })).toEqual([]);
  });

  it("keeps context on both sides of an interior run", () => {
    const chunks = [change(0, 0), equal(1, 30, 1), change(31, 31)];
    const [fold] = computeFolds(chunks, { contextLines: 3 });
    expect(fold.left).toEqual({ start: 4, count: 24 });
    expect(fold.hiddenLines).toBe(24);
  });

  it("keeps context only on the inner edge at the start and end of a file", () => {
    // Nothing precedes the first run, so leading context would be context for
    // nothing at all.
    const chunks = [equal(0, 30, 0), change(30, 30), equal(31, 30, 31)];
    const folds = computeFolds(chunks, { contextLines: 3 });
    expect(folds[0].left).toEqual({ start: 0, count: 27 });
    expect(folds[1].left).toEqual({ start: 34, count: 27 });
  });

  it("never folds a changed chunk", () => {
    expect(
      computeFolds([change(0, 0)], { contextLines: 0, minimumLines: 0 }),
    ).toEqual([]);
  });
});

describe("chooseLayout", () => {
  it("collapses an added file to its right side", () => {
    expect(chooseLayout("", lines("a", "b"))).toEqual({
      mode: "single",
      side: "right",
    });
  });

  it("collapses a deleted file to its left side", () => {
    expect(chooseLayout(lines("a", "b"), "")).toEqual({
      mode: "single",
      side: "left",
    });
  });

  it("splits when both sides have content", () => {
    expect(chooseLayout(lines("a"), lines("b"))).toEqual({ mode: "split" });
  });

  it("splits when neither side has content, rather than picking arbitrarily", () => {
    expect(chooseLayout("", "")).toEqual({ mode: "split" });
  });

  it("does not collapse a file emptied to a single blank line", () => {
    // "\n" is one empty line, not an absent file; only a truly empty side is
    // a deletion.
    expect(chooseLayout(lines("a"), "\n")).toEqual({ mode: "split" });
  });
});

describe("connectorPath", () => {
  const band = { width: 80, gapStart: 26, gapEnd: 54 };

  it("runs flat to the gap, bends inside it, then runs flat to the far edge", () => {
    expect(connectorPath({ ay0: 10, ay1: 30, by0: 40, by1: 80 }, band)).toBe(
      "M0 10 L26 10 C40 10 40 40 54 40 L80 40 L80 80 L54 80 C40 80 40 30 26 30 L0 30 Z",
    );
  });

  it("keeps every bend between the line-number columns", () => {
    // The reason the gap exists: a curve spanning the whole gutter crosses
    // both number columns on its way, and over a tall chunk it crosses them
    // at a steep angle right where the digits are.
    const path = connectorPath({ ay0: 0, ay1: 4, by0: 300, by1: 400 }, band);
    const controlPoints = [
      ...path.matchAll(/C([\d.]+) [\d.-]+ ([\d.]+) /g),
    ].flatMap((match) => [Number(match[1]), Number(match[2])]);
    expect(controlPoints.length).toBeGreaterThan(0);
    for (const x of controlPoints) {
      expect(x).toBeGreaterThanOrEqual(band.gapStart);
      expect(x).toBeLessThanOrEqual(band.gapEnd);
    }
  });

  it("degenerates to a wedge for an insertion, where the left edges coincide", () => {
    const path = connectorPath({ ay0: 20, ay1: 20, by0: 0, by1: 60 }, band);
    expect(path).toBe(
      "M0 20 L26 20 C40 20 40 0 54 0 L80 0 L80 60 L54 60 C40 60 40 20 26 20 L0 20 Z",
    );
  });

  it("degenerates to a rectangle when both sides align", () => {
    expect(connectorPath({ ay0: 0, ay1: 20, by0: 0, by1: 20 }, band)).toBe(
      "M0 0 L26 0 C40 0 40 0 54 0 L80 0 L80 20 L54 20 C40 20 40 20 26 20 L0 20 Z",
    );
  });

  it("spans the full gutter width so it meets both panes", () => {
    const path = connectorPath({ ay0: 5, ay1: 25, by0: 45, by1: 95 }, band);
    expect(path.startsWith("M0 ")).toBe(true);
    expect(path).toContain(`L${band.width} `);
  });
});

describe("the display-line coordinate", () => {
  // A modified pair, a long equal run, an insertion, and a trailing equal
  // run — enough to exercise folding on both sides of a drift.
  const chunks: DiffChunk[] = [
    {
      kind: "modified",
      left: { start: 0, count: 2 },
      right: { start: 0, count: 2 },
    },
    {
      kind: "equal",
      left: { start: 2, count: 40 },
      right: { start: 2, count: 40 },
    },
    {
      kind: "added",
      left: { start: 42, count: 0 },
      right: { start: 42, count: 5 },
    },
    {
      kind: "equal",
      left: { start: 42, count: 8 },
      right: { start: 47, count: 8 },
    },
  ];
  const folds = computeFolds(chunks, { contextLines: 3 });

  it("folds the interior run and the trailing run of this fixture", () => {
    // The interior run keeps context on both edges; the trailing run only on
    // its inner edge. Pinned here because every number below depends on it.
    expect(folds).toEqual([
      {
        chunkIndex: 1,
        left: { start: 5, count: 34 },
        right: { start: 5, count: 34 },
        hiddenLines: 34,
      },
      {
        chunkIndex: 3,
        left: { start: 45, count: 5 },
        right: { start: 50, count: 5 },
        hiddenLines: 5,
      },
    ]);
  });

  it("shrinks the axis to the visible rows plus one per fold", () => {
    expect(axisLength(chunks)).toBe(55);
    // 2 + (3 + 1 + 3) + 5 + (3 + 1) = 18
    expect(axisLength(chunks, folds)).toBe(18);
  });

  it("shrinks a folded chunk's span the same way for the stripe", () => {
    expect(chunkAxisSpan(chunks, 1, folds)).toBe(7);
    expect(chunkAxisSpan(chunks, 2, folds)).toBe(5);
  });

  it("maps lines below a fold up by the hidden count minus the fold row", () => {
    expect(displayLine(folds, 4, "left")).toBe(4);
    expect(displayLine(folds, 39, "left")).toBe(6);
    expect(displayLine(folds, 47, "right")).toBe(14);
  });

  it("maps a hidden line to the fold's own row", () => {
    expect(displayLine(folds, 20, "left")).toBe(5);
    expect(displayLine(folds, 52, "right")).toBe(17);
  });

  it("resolves display rows back to lines, and fold rows to their fold", () => {
    expect(displayToSource(folds, 4, "left")).toEqual({
      kind: "line",
      line: 4,
    });
    expect(displayToSource(folds, 5, "left")).toEqual({
      kind: "fold",
      fold: folds[0],
    });
    expect(displayToSource(folds, 6, "left")).toEqual({
      kind: "line",
      line: 39,
    });
    expect(displayToSource(folds, 12, "left")).toEqual({
      kind: "fold",
      fold: folds[1],
    });
  });

  it("counts display rows as lines minus hidden plus one per fold", () => {
    expect(displayLineCount(50, folds)).toBe(13);
    expect(displayLineCount(50, [])).toBe(50);
  });

  it("still lets the right advance through an insertion while the left stands", () => {
    expect(axisToSide(chunks, 11, "left", folds)).toBe(9);
    expect(axisToSide(chunks, 11, "right", folds)).toBe(11);
  });

  it("moves continuously across fold boundaries too", () => {
    // The fold-crossing extension of the quarter-line walk that caught the
    // original left-to-right mapping bug.
    for (const side of ["left", "right"] as const) {
      const at = (position: number) =>
        axisToSide(chunks, position, side, folds);
      for (let position = 0; position < 18; position += 0.25) {
        expect(
          Math.abs(at(position + 0.25) - at(position)),
        ).toBeLessThanOrEqual(0.25 + 1e-9);
      }
    }
  });

  it("round-trips a visible line through the folded axis", () => {
    expect(sideToAxis(chunks, 39, "left", folds)).toBe(6);
    expect(sideToAxis(chunks, 47, "right", folds)).toBe(14);
  });

  it("sends a hidden line to its fold row rather than a phantom position", () => {
    expect(sideToAxis(chunks, 20, "left", folds)).toBe(5);
  });

  it("reduces to the unfolded mapping when no folds are passed", () => {
    for (let position = 0; position <= 55; position += 1) {
      expect(axisToSide(chunks, position, "right", [])).toBe(
        axisToSide(chunks, position, "right"),
      );
    }
  });
});
