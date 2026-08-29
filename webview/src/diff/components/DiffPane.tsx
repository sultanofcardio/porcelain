import { useMemo } from "react";
import { useShiki } from "../../shared/hooks/useShiki";
import type { DiffChunk, Side } from "../utils/diff-model";
import type { FindMatch } from "../utils/find";
import { buildPieces, changedRanges, syntaxSpans } from "../utils/highlight";
import { LINE_HEIGHT } from "./metrics";

interface DiffPaneProps {
  side: Side;
  lines: string[];
  /** The other side's lines, for word-level comparison within a chunk. */
  counterpart: string[];
  chunks: DiffChunk[];
  language: string;
  granularity: "line" | "word" | "character" | "none";
  /** Fractional line offset of the top of the viewport on this side. */
  offset: number;
  visibleLines: number;
  /** Find hits across both sides; the pane keeps only its own. */
  matches?: FindMatch[];
  /** The match the find stepper is on, when there is one. */
  activeMatch?: FindMatch | null;
}

/**
 * Where a chunk lands on a side that contributes no lines to it.
 *
 * An insertion has nothing to show on the left, so without a marker there is
 * no way to see *where* the new lines go — the connector tapers to a point at
 * the gutter edge and stops. A full-width rule across the pane puts the
 * insertion point back on the side that lacks it.
 */
function anchorsFor(chunks: DiffChunk[], side: Side) {
  return chunks.flatMap((chunk) => {
    const own = side === "left" ? chunk.left : chunk.right;
    const other = side === "left" ? chunk.right : chunk.left;
    if (own.count > 0 || other.count === 0) return [];
    return [{ line: own.start, kind: chunk.kind }];
  });
}

/** Which chunk a line belongs to, or undefined outside every chunk. */
function chunkAt(chunks: DiffChunk[], side: Side, line: number) {
  return chunks.find((chunk) => {
    const span = side === "left" ? chunk.left : chunk.right;
    return line >= span.start && line < span.start + span.count;
  });
}

export function DiffPane({
  side,
  lines,
  counterpart,
  chunks,
  language,
  granularity,
  offset,
  visibleLines,
  matches = [],
  activeMatch = null,
}: DiffPaneProps) {
  const highlighter = useShiki();

  // Only the visible window is highlighted. Shiki tokenises per line, so the
  // cost tracks the viewport rather than the file, which is what keeps a
  // 20k-line diff from tokenising 20k lines to show forty of them.
  const first = Math.max(0, Math.floor(offset));
  const last = Math.min(lines.length, first + visibleLines + 2);

  // This side's find hits, addressable by line. Rebuilt only when the match
  // list changes, not on every scroll.
  const matchesByLine = useMemo(() => {
    const byLine = new Map<number, Array<{ start: number; end: number }>>();
    for (const match of matches) {
      if (match.side !== side) continue;
      const ranges = byLine.get(match.line);
      if (ranges) ranges.push({ start: match.start, end: match.end });
      else byLine.set(match.line, [{ start: match.start, end: match.end }]);
    }
    return byLine;
  }, [matches, side]);

  const rows = useMemo(() => {
    const rendered = [];
    for (let index = first; index < last; index++) {
      const line = lines[index] ?? "";
      const chunk = chunkAt(chunks, side, index);
      const kind = chunk?.kind ?? "equal";

      let ranges: Array<{ start: number; end: number }> | null = [];
      if (kind === "modified") {
        const span = side === "left" ? chunk?.left : chunk?.right;
        const other = side === "left" ? chunk?.right : chunk?.left;
        const positionInChunk = span ? index - span.start : 0;
        const against =
          other && positionInChunk < other.count
            ? counterpart[other.start + positionInChunk]
            : undefined;
        ranges = changedRanges(line, against, granularity);
      }
      // Added and removed lines are wholly new or wholly gone, so the line
      // background already says so. Marking every token as changed on top of
      // it double-paints the row and leaves gaps between spans; intra-line
      // highlighting is only meaningful where a line was edited.

      const active =
        activeMatch && activeMatch.side === side && activeMatch.line === index
          ? { start: activeMatch.start, end: activeMatch.end }
          : null;

      rendered.push({
        index,
        kind,
        pieces: buildPieces(
          line,
          syntaxSpans(highlighter, line, language),
          ranges,
          matchesByLine.get(index) ?? [],
          active,
        ),
      });
    }
    return rendered;
  }, [
    first,
    last,
    lines,
    counterpart,
    chunks,
    side,
    language,
    granularity,
    highlighter,
    matchesByLine,
    activeMatch,
  ]);

  // Only the anchors near the viewport: a large file has one per insertion,
  // and the rest would be DOM for nothing.
  const anchors = anchorsFor(chunks, side).filter(
    (anchor) =>
      anchor.line >= offset - 2 && anchor.line <= offset + visibleLines + 2,
  );

  return (
    <div className="diff-pane">
      {anchors.map((anchor) => (
        <div
          key={`anchor-${anchor.line}`}
          className={`diff-anchor diff-anchor-${anchor.kind}`}
          style={{ top: (anchor.line - offset) * LINE_HEIGHT }}
        />
      ))}
      <div
        className="diff-pane-lines"
        style={{
          transform: `translateY(${-(offset - first) * LINE_HEIGHT}px)`,
        }}
      >
        {rows.map((row) => (
          <div key={row.index} className={`diff-line diff-line-${row.kind}`}>
            {row.pieces.length === 0
              ? " "
              : row.pieces.map((piece, i) => (
                  <span
                    // Pieces are positional slices of one line; there is no
                    // stable identity to key on beyond where they sit.
                    key={`${row.index}-${i}`}
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
          </div>
        ))}
      </div>
    </div>
  );
}
