import { useMemo } from "react";
import { useShiki } from "../../shared/hooks/useShiki";
import type { DiffChunk, FoldRegion } from "../utils/diff-model";
import type { FindMatch } from "../utils/find";
import {
  buildPieces,
  changedRanges,
  type Piece,
  syntaxSpans,
} from "../utils/highlight";
import type { UnifiedRow } from "../utils/unified";
import { gutterMetrics, LINE_HEIGHT } from "./metrics";

interface UnifiedPaneProps {
  rows: UnifiedRow[];
  leftLines: string[];
  rightLines: string[];
  chunks: DiffChunk[];
  language: string;
  granularity: "line" | "word" | "character" | "none";
  /** Fractional row offset of the top of the viewport. */
  offset: number;
  visibleLines: number;
  onToggleFold?: (fold: FoldRegion) => void;
  matches?: FindMatch[];
  activeMatch?: FindMatch | null;
}

/**
 * The one-column view: the same chunks, folds, find state and highlight
 * pipeline as the split panes, rendered removed-then-added instead of
 * side-by-side. Both number columns sit at the left edge — a row that exists
 * on only one side leaves the other column blank, which is how the eye tells
 * a removal from an addition without reading colours.
 */
export function UnifiedPane({
  rows,
  leftLines,
  rightLines,
  chunks,
  language,
  granularity,
  offset,
  visibleLines,
  onToggleFold,
  matches = [],
  activeMatch = null,
}: UnifiedPaneProps) {
  const highlighter = useShiki();
  const metrics = gutterMetrics(Math.max(leftLines.length, rightLines.length));

  const first = Math.max(0, Math.floor(offset));
  const last = Math.min(rows.length, first + visibleLines + 2);

  // Both sides' hits, addressable by (side, line) — the unified view shows
  // every line of both documents, so nothing is filtered out.
  const matchesByLine = useMemo(() => {
    const byLine = new Map<string, Array<{ start: number; end: number }>>();
    for (const match of matches) {
      const key = `${match.side}:${match.line}`;
      const ranges = byLine.get(key);
      if (ranges) ranges.push({ start: match.start, end: match.end });
      else byLine.set(key, [{ start: match.start, end: match.end }]);
    }
    return byLine;
  }, [matches]);

  const rendered = useMemo(() => {
    type RenderedRow =
      | { index: number; fold: FoldRegion }
      | {
          index: number;
          row: Extract<UnifiedRow, { kind: "line" }>;
          pieces: Piece[];
        };
    const out: RenderedRow[] = [];
    for (let index = first; index < last; index++) {
      const row = rows[index];
      if (!row) break;
      if (row.kind === "fold") {
        out.push({ index, fold: row.fold });
        continue;
      }
      const text =
        row.side === "left" ? leftLines[row.line] : rightLines[row.line];
      const line = text ?? "";

      // Word-level comparison within a modified pair works exactly as in the
      // split panes: each half diffs against the same-position line of the
      // other half.
      let ranges: Array<{ start: number; end: number }> | null = [];
      if (row.chunkKind === "modified") {
        const chunk = chunks[row.chunkIndex];
        const own = row.side === "left" ? chunk.left : chunk.right;
        const other = row.side === "left" ? chunk.right : chunk.left;
        const positionInChunk = row.line - own.start;
        const against =
          positionInChunk < other.count
            ? (row.side === "left" ? rightLines : leftLines)[
                other.start + positionInChunk
              ]
            : undefined;
        ranges = changedRanges(line, against, granularity);
      }

      // An equal row stands for the same text on both sides, so it shows
      // hits addressed to either twin, and the active match counts wherever
      // stepping landed. Offsets from the two sides agree because the texts
      // are identical — except under whitespace-ignoring chunking, where a
      // left-side range may sit a few columns off the rendered right text.
      const found =
        row.chunkKind === "equal"
          ? unionRanges(
              matchesByLine.get(`left:${(row.leftNumber ?? 0) - 1}`),
              matchesByLine.get(`right:${(row.rightNumber ?? 0) - 1}`),
            )
          : (matchesByLine.get(`${row.side}:${row.line}`) ?? []);

      const active =
        activeMatch &&
        (row.chunkKind === "equal"
          ? activeMatch.line ===
            (activeMatch.side === "left"
              ? (row.leftNumber ?? 0) - 1
              : (row.rightNumber ?? 0) - 1)
          : activeMatch.side === row.side && activeMatch.line === row.line)
          ? { start: activeMatch.start, end: activeMatch.end }
          : null;

      out.push({
        index,
        row,
        pieces: buildPieces(
          line,
          syntaxSpans(highlighter, line, language),
          ranges,
          found,
          active,
        ),
      });
    }
    return out;
  }, [
    first,
    last,
    rows,
    leftLines,
    rightLines,
    chunks,
    language,
    granularity,
    highlighter,
    matchesByLine,
    activeMatch,
  ]);

  return (
    <div className="diff-unified">
      <div
        className="diff-pane-lines"
        style={{
          transform: `translateY(${-(offset - first) * LINE_HEIGHT}px)`,
        }}
      >
        {rendered.map((entry) =>
          "fold" in entry ? (
            <button
              key={entry.index}
              type="button"
              className="diff-fold-row"
              aria-label={`Expand ${entry.fold.hiddenLines} unchanged lines`}
              onClick={() => onToggleFold?.(entry.fold)}
              style={{ paddingLeft: metrics.numberWidth * 2 + 10 }}
            >
              <span aria-hidden="true">▸ </span>
              {entry.fold.hiddenLines} unchanged lines
            </button>
          ) : (
            <div
              key={entry.index}
              className={`diff-line diff-unified-line diff-line-${
                entry.row.chunkKind === "modified"
                  ? "modified"
                  : entry.row.chunkKind
              }`}
            >
              <span className="diff-sr-only">
                {`Line ${
                  (entry.row.rightNumber ?? entry.row.leftNumber ?? 0) as number
                }${entry.row.chunkKind === "equal" ? "" : `, ${unifiedKindLabel(entry.row)}`}: `}
              </span>
              <span
                className="diff-unified-number"
                style={{ width: metrics.numberWidth }}
                aria-hidden="true"
              >
                {entry.row.leftNumber ?? ""}
              </span>
              <span
                className="diff-unified-number"
                style={{ width: metrics.numberWidth }}
                aria-hidden="true"
              >
                {entry.row.rightNumber ?? ""}
              </span>
              <span className="diff-unified-text">
                {entry.pieces.length === 0
                  ? " "
                  : entry.pieces.map((piece, i) => (
                      <span
                        // Pieces are positional slices of one line; there is
                        // no stable identity beyond where they sit.
                        key={`${entry.index}-${i}`}
                        className={
                          [
                            piece.changed ? "diff-changed" : "",
                            piece.activeFound
                              ? "diff-found-active"
                              : piece.found
                                ? "diff-found"
                                : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
                        style={{ color: piece.color }}
                      >
                        {piece.text}
                      </span>
                    ))}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** Both twins' ranges, minus exact duplicates — identical text, identical hit. */
function unionRanges(
  left: Array<{ start: number; end: number }> | undefined,
  right: Array<{ start: number; end: number }> | undefined,
): Array<{ start: number; end: number }> {
  if (!left) return right ?? [];
  if (!right) return left;
  const merged = [...left];
  for (const range of right) {
    if (
      !merged.some((r) => r.start === range.start && r.end === range.end)
    )
      merged.push(range);
  }
  return merged;
}

/**
 * What a screen reader hears for a changed unified row. A modified pair keeps
 * its own name, qualified by which half this row is — "modified, old" reads
 * as an edit, where "removed" would read as a deletion that is not one.
 */
function unifiedKindLabel(row: Extract<UnifiedRow, { kind: "line" }>): string {
  if (row.chunkKind !== "modified") return row.chunkKind;
  return row.side === "left" ? "modified, old" : "modified, new";
}
