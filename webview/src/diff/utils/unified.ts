import type { DiffChunk, FoldRegion, Side } from "./diff-model";

/**
 * One row of the unified view.
 *
 * Unified is a second row-builder over the same model the split view uses:
 * chunks in order, an equal chunk contributing one row per line, an unequal
 * chunk contributing its removed lines then its added lines. A folded equal
 * chunk contributes leading context, one fold row, trailing context — the
 * same shape the display-line coordinate gives the split panes.
 */
export type UnifiedRow =
  | {
      kind: "line";
      chunkKind: "equal" | "modified" | "added" | "removed";
      // A modified pair keeps its own kind on both halves: an edited line is
      // not an addition, in this layout or the other one.
      /** Which document the text comes from. Equal rows read from the right. */
      side: Side;
      line: number;
      leftNumber: number | null;
      rightNumber: number | null;
      chunkIndex: number;
    }
  | { kind: "fold"; fold: FoldRegion };

export function unifiedRows(
  chunks: readonly DiffChunk[],
  folds: readonly FoldRegion[] = [],
): UnifiedRow[] {
  const foldOf = new Map(folds.map((fold) => [fold.chunkIndex, fold]));
  const rows: UnifiedRow[] = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunk.kind === "equal") {
      const fold = foldOf.get(chunkIndex);
      // Folds only land on balanced equal chunks, so where a chunk is folded
      // its two sides have the same count and `paired` covers all of it.
      const paired = Math.min(chunk.left.count, chunk.right.count);
      for (let i = 0; i < paired; i++) {
        if (fold) {
          const hiddenStart = fold.left.start - chunk.left.start;
          const hiddenEnd = hiddenStart + fold.left.count;
          if (i === hiddenStart) rows.push({ kind: "fold", fold });
          if (i >= hiddenStart && i < hiddenEnd) continue;
        }
        rows.push({
          kind: "line",
          chunkKind: "equal",
          side: "right",
          line: chunk.right.start + i,
          leftNumber: chunk.left.start + i + 1,
          rightNumber: chunk.right.start + i + 1,
          chunkIndex,
        });
      }
      // A blank line ignored on one side under "ignore-empty" leaves that side
      // with surplus equal lines; show each on its own side so every real line
      // still gets a row rather than reading a line off the shorter side.
      for (let i = paired; i < chunk.left.count; i++) {
        rows.push({
          kind: "line",
          chunkKind: "equal",
          side: "left",
          line: chunk.left.start + i,
          leftNumber: chunk.left.start + i + 1,
          rightNumber: null,
          chunkIndex,
        });
      }
      for (let i = paired; i < chunk.right.count; i++) {
        rows.push({
          kind: "line",
          chunkKind: "equal",
          side: "right",
          line: chunk.right.start + i,
          leftNumber: null,
          rightNumber: chunk.right.start + i + 1,
          chunkIndex,
        });
      }
      continue;
    }
    for (let i = 0; i < chunk.left.count; i++) {
      rows.push({
        kind: "line",
        chunkKind: chunk.kind,
        side: "left",
        line: chunk.left.start + i,
        leftNumber: chunk.left.start + i + 1,
        rightNumber: null,
        chunkIndex,
      });
    }
    for (let i = 0; i < chunk.right.count; i++) {
      rows.push({
        kind: "line",
        chunkKind: chunk.kind,
        side: "right",
        line: chunk.right.start + i,
        leftNumber: null,
        rightNumber: chunk.right.start + i + 1,
        chunkIndex,
      });
    }
  }
  return rows;
}

/** The row showing `line` of `side`, or the fold row hiding it. -1 if absent. */
export function unifiedRowOf(
  rows: readonly UnifiedRow[],
  side: Side,
  line: number,
): number {
  return rows.findIndex((row) => {
    if (row.kind === "fold") {
      const span = side === "left" ? row.fold.left : row.fold.right;
      return line >= span.start && line < span.start + span.count;
    }
    if (side === "left") {
      return row.leftNumber !== null && row.leftNumber - 1 === line;
    }
    return row.rightNumber !== null && row.rightNumber - 1 === line;
  });
}

/** The first row of a chunk, for difference stepping. -1 if fully hidden. */
export function unifiedChunkRow(
  rows: readonly UnifiedRow[],
  chunkIndex: number,
): number {
  return rows.findIndex(
    (row) => row.kind === "line" && row.chunkIndex === chunkIndex,
  );
}

/**
 * The unified view's stripe marks: runs of consecutive changed rows, one mark
 * per changed chunk, in row units. A modified pair is one mark spanning both
 * halves — the stripe summarises differences, not their layout.
 */
export function unifiedStripeMarks(
  rows: readonly UnifiedRow[],
): Array<{ start: number; span: number; kind: string }> {
  const marks: Array<{ start: number; span: number; kind: string }> = [];
  for (const [index, row] of rows.entries()) {
    if (row.kind !== "line" || row.chunkKind === "equal") continue;
    const last = marks[marks.length - 1];
    if (
      last &&
      last.start + last.span === index &&
      last.kind === row.chunkKind
    ) {
      last.span += 1;
      continue;
    }
    marks.push({ start: index, span: 1, kind: row.chunkKind });
  }
  return marks;
}
