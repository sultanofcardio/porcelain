import { describe, expect, it } from "vitest";
import { computeChunks, computeFolds, type DiffChunk } from "./diff-model";
import {
  unifiedChunkRow,
  unifiedRowOf,
  unifiedRows,
  unifiedStripeMarks,
} from "./unified";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

describe("unifiedRows", () => {
  it("orders a modified pair as its old lines then its new lines", () => {
    const chunks = computeChunks(
      lines("a", "old", "c"),
      lines("a", "new", "c"),
    );
    const rows = unifiedRows(chunks);
    expect(
      rows.map((row) =>
        row.kind === "line"
          ? [row.chunkKind, row.side, row.leftNumber, row.rightNumber]
          : "fold",
      ),
    ).toEqual([
      ["equal", "right", 1, 1],
      ["modified", "left", 2, null],
      ["modified", "right", null, 2],
      ["equal", "right", 3, 3],
    ]);
  });

  it("keeps a modified pair's own kind on both halves", () => {
    // An edited line is not an addition, in this layout or the other one.
    const chunks = computeChunks(lines("old"), lines("new"));
    const rows = unifiedRows(chunks);
    expect(
      rows.every((row) => row.kind === "line" && row.chunkKind === "modified"),
    ).toBe(true);
  });

  it("numbers both columns on an equal row and one column elsewhere", () => {
    const chunks = computeChunks(lines("a", "b"), lines("a", "x", "b"));
    const rows = unifiedRows(chunks);
    const added = rows.find(
      (row) => row.kind === "line" && row.chunkKind === "added",
    );
    expect(added && added.kind === "line" && added.leftNumber).toBeNull();
    expect(added && added.kind === "line" && added.rightNumber).toBe(2);
  });

  it("collapses a folded run to context, one fold row, context", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const chunks = computeChunks(lines("old", ...body), lines("new", ...body));
    const folds = computeFolds(chunks);
    const rows = unifiedRows(chunks, folds);
    // 2 modified halves + 3 leading context + 1 fold + 0 trailing (end of
    // file keeps context only on its inner edge).
    expect(rows).toHaveLength(2 + 3 + 1);
    expect(rows[rows.length - 1].kind).toBe("fold");
  });

  it("is the identity over line counts when nothing is folded", () => {
    const left = lines("a", "x", "c");
    const right = lines("a", "y", "z", "c");
    const rows = unifiedRows(computeChunks(left, right));
    // Every line of both documents appears exactly once.
    expect(rows).toHaveLength(3 + 4 - 2);
  });
});

describe("unifiedRowOf", () => {
  const chunks = computeChunks(lines("a", "old", "c"), lines("a", "new", "c"));
  const rows = unifiedRows(chunks);

  it("finds a line on either side", () => {
    expect(unifiedRowOf(rows, "left", 1)).toBe(1);
    expect(unifiedRowOf(rows, "right", 1)).toBe(2);
    // The equal line answers for both sides.
    expect(unifiedRowOf(rows, "left", 2)).toBe(3);
    expect(unifiedRowOf(rows, "right", 2)).toBe(3);
  });

  it("resolves a hidden line to its fold row", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const foldedChunks = computeChunks(
      lines("old", ...body),
      lines("new", ...body),
    );
    const folds = computeFolds(foldedChunks);
    const foldedRows = unifiedRows(foldedChunks, folds);
    const hidden = unifiedRowOf(foldedRows, "left", 20);
    expect(foldedRows[hidden]?.kind).toBe("fold");
  });
});

describe("unifiedChunkRow", () => {
  it("finds the first row of a chunk for difference stepping", () => {
    const chunks = computeChunks(
      lines("a", "old", "c"),
      lines("a", "new", "c"),
    );
    const rows = unifiedRows(chunks);
    expect(unifiedChunkRow(rows, 1)).toBe(1);
  });
});

describe("unifiedStripeMarks", () => {
  it("emits one mark spanning both halves of a modified pair", () => {
    const chunks: DiffChunk[] = computeChunks(
      lines("a", "old", "c", "e"),
      lines("a", "new", "c", "x", "e"),
    );
    const marks = unifiedStripeMarks(unifiedRows(chunks));
    expect(marks).toEqual([
      { start: 1, span: 2, kind: "modified" },
      { start: 4, span: 1, kind: "added" },
    ]);
  });
});
