import { type Ref, useCallback, useEffect, useMemo, useRef } from "react";
import { useShiki } from "../../shared/hooks/useShiki";
import {
  colAtVisual,
  lineEnd,
  lineStart,
  moveHorizontal,
  moveWord,
  type Position,
  visualCol,
} from "../editor/editor-model";
import type { DiffChunk, FoldRegion, Side } from "../utils/diff-model";
import type { FindMatch } from "../utils/find";
import {
  buildPieces,
  changedRanges,
  type Piece,
  syntaxSpans,
} from "../utils/highlight";
import { positionAt, rowAt } from "../utils/positionAt";
import { type UnifiedRow, unifiedRowOf } from "../utils/unified";
import {
  CARET_WIDTH,
  gutterMetrics,
  LINE_HEIGHT,
  PANE_TEXT_PADDING,
  useCharWidth,
  useForwardedRef,
} from "./metrics";

/** A caret in the one-column view names the document it sits in. */
export interface UnifiedCaret extends Position {
  side: Side;
}

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
  /** The pane's element - its horizontal scroll container, as in DiffPane. */
  ref?: Ref<HTMLDivElement>;
  /**
   * The least scrollable width of the *text*, in px; the pane adds its two
   * number columns in front. See DiffPane for why it comes from the caller.
   */
  contentWidth?: number;
  /** The pane scrolled sideways; `x` is its new scrollLeft. */
  onScrollX?: (x: number) => void;
  /**
   * How far the pane is scrolled sideways, in px. The caret draws in content
   * coordinates while the two number columns are parked at the left edge, so
   * this is what says whether the caret has slid under them.
   */
  scrollX?: number;
  /**
   * The read-only caret, on whichever document the active pane shows. The
   * unified view is read-only even for the working tree, so this is the
   * only caret it draws; a click places it on the row's own document.
   */
  caret?: UnifiedCaret | null;
  onPlaceCaret?: (side: Side, position: Position) => void;
  /** Scroll the surface so a row sits inside the viewport. */
  onRevealRow?: (row: number) => void;
  /** Scroll the pane sideways so the content span [from, to] px is in view. */
  onRevealX?: (from: number, to: number) => void;
  /** Accessible name for the pane, which takes focus for its caret. */
  label?: string;
}

/**
 * The row showing `caret`, or -1. An equal row stands for both twins, and a
 * caret inside a collapsed run resolves to the fold row hiding it, the way
 * the split panes draw one on their fold row.
 */
export function unifiedCaretRow(
  rows: readonly UnifiedRow[],
  caret: UnifiedCaret,
): number {
  return unifiedRowOf(rows, caret.side, caret.line);
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
  ref,
  contentWidth,
  onScrollX,
  scrollX = 0,
  caret = null,
  onPlaceCaret,
  onRevealRow,
  onRevealX,
  label,
}: UnifiedPaneProps) {
  const highlighter = useShiki();
  const metrics = gutterMetrics(Math.max(leftLines.length, rightLines.length));

  const hostRef = useRef<HTMLDivElement | null>(null);
  const setHost = useForwardedRef(hostRef, ref);
  const charWidth = useCharWidth(hostRef);
  const goalRef = useRef<number | null>(null);
  // Where a row's text starts: after both number columns and the text inset.
  const textInset = metrics.numberWidth * 2 + PANE_TEXT_PADDING;
  const textOf = useCallback(
    (side: Side, line: number) =>
      (side === "left" ? leftLines[line] : rightLines[line]) ?? "",
    [leftLines, rightLines],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (!host || !onPlaceCaret) return;
      if ((event.target as HTMLElement).closest("button")) return;
      const bounds = host.getBoundingClientRect();
      if (event.clientY >= bounds.top + host.clientHeight) return;
      // A unified row names its own document, so the row is resolved first
      // and the shared geometry reads the column off that side's lines.
      const row = rows[rowAt(event, { rect: bounds, offset })];
      if (!row || row.kind !== "line") return;
      const position = positionAt(event, {
        rect: bounds,
        offset,
        scrollX: host.scrollLeft,
        charWidth,
        toSourceLine: () => row.line,
        lines: row.side === "left" ? leftLines : rightLines,
        textInset,
      });
      if (!position) return;
      goalRef.current = null;
      onPlaceCaret(row.side, position);
    },
    [onPlaceCaret, offset, rows, textInset, charWidth, leftLines, rightLines],
  );

  // Scanning the row list is O(rows), and the pane re-renders on every
  // scroll event: the caret's identity is the only thing that moves it.
  const caretRow = useMemo(
    () => (caret ? unifiedCaretRow(rows, caret) : -1),
    [rows, caret],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!caret || !onPlaceCaret || caretRow < 0) return;
      if (event.target !== event.currentTarget) return;
      const primary = event.metaKey || event.ctrlKey;
      const text = textOf(caret.side, caret.line);
      const lines = caret.side === "left" ? leftLines : rightLines;
      // Vertical moves walk rows, not lines: the next row may belong to the
      // other document, and the caret follows it there. The goal column is
      // sticky across consecutive moves, so a short line on the way does not
      // pull the caret in for good.
      const toRow = (delta: number): number => {
        const goal = goalRef.current ?? visualCol(text, caret.col);
        let index = caretRow;
        const step = delta < 0 ? -1 : 1;
        for (let n = Math.abs(delta); n > 0; ) {
          const candidate = index + step;
          if (candidate < 0 || candidate >= rows.length) break;
          index = candidate;
          if (rows[index].kind === "line") n--;
        }
        const row = rows[index];
        if (row.kind !== "line") return goal;
        const target = textOf(row.side, row.line);
        onPlaceCaret(row.side, {
          line: row.line,
          col: colAtVisual(target, goal),
        });
        return goal;
      };
      let next: Position | null = null;
      let goal: number | null = null;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          const delta = event.key === "ArrowLeft" ? -1 : 1;
          next = primary
            ? delta < 0
              ? lineStart(caret)
              : lineEnd(lines, caret)
            : event.altKey
              ? moveWord(lines, caret, delta)
              : moveHorizontal(lines, caret, delta);
          break;
        }
        case "ArrowUp":
        case "ArrowDown":
          // Alt+ArrowUp/Down steps to the previous or next file; that
          // binding lives on the window, so the key has to reach it.
          if (event.altKey) return;
          goal = toRow(event.key === "ArrowUp" ? -1 : 1);
          break;
        case "PageUp":
        case "PageDown":
          goal = toRow(
            (event.key === "PageUp" ? -1 : 1) * Math.max(1, visibleLines - 2),
          );
          break;
        case "Home":
          next = lineStart(caret);
          break;
        case "End":
          next = lineEnd(lines, caret);
          break;
        default:
          return;
      }
      goalRef.current = goal;
      event.preventDefault();
      event.stopPropagation();
      if (next) onPlaceCaret(caret.side, next);
    },
    [
      caret,
      onPlaceCaret,
      caretRow,
      rows,
      textOf,
      leftLines,
      rightLines,
      visibleLines,
    ],
  );

  // Follow the caret; see DiffPane for why this keys on identity alone.
  const caretKey = caret ? `${caret.side}:${caret.line}:${caret.col}` : null;
  const revealState = {
    caret,
    caretRow,
    offset,
    visibleLines,
    onRevealRow,
    onRevealX,
    textInset,
    charWidth,
    textOf,
  };
  const revealRef = useRef(revealState);
  revealRef.current = revealState;
  // The load-time reveal owns where a diff opens, and a caret exists from
  // mount: the pane follows the caret only once it has seen it move, so a
  // remount (switching view modes) leaves the reader where they scrolled to.
  const followedFrom = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = followedFrom.current;
    followedFrom.current = caretKey;
    if (caretKey === null || previous === undefined) return;
    const {
      caret: here,
      caretRow: row,
      offset: at,
      visibleLines: count,
      onRevealRow: go,
      onRevealX: goX,
      textInset: inset,
      charWidth: cell,
      textOf: read,
    } = revealRef.current;
    if (!here || count === 0 || row < 0) return;
    if (go && (row < at + 0.5 || row > at + count - 1.5)) {
      go(Math.max(0, row - Math.floor(count / 2)));
    }
    // And sideways, as the split panes do: the caret's span in the pane's
    // own (unscrolled) x, both number columns included.
    if (goX) {
      const x = inset + visualCol(read(here.side, here.line), here.col) * cell;
      goX(x, x + CARET_WIDTH);
    }
  }, [caretKey]);

  // Where the caret draws, in the content's own x.
  const caretX =
    caret === null
      ? 0
      : textInset +
        visualCol(textOf(caret.side, caret.line), caret.col) * charWidth;
  // The number columns are sticky inside the rows' own stacking context, so
  // a caret scrolled behind them would paint over the numbers. It stops
  // being drawn at their edge instead, as it does at the viewport's.
  const caretShown =
    caret !== null &&
    caretRow >= 0 &&
    caretRow >= offset - 1 &&
    caretRow <= offset + visibleLines + 1 &&
    caretX - scrollX >= metrics.numberWidth * 2;

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
    <div
      className="diff-unified"
      ref={setHost}
      onScroll={(event) => onScrollX?.(event.currentTarget.scrollLeft)}
      onMouseDown={onPlaceCaret ? onMouseDown : undefined}
      onKeyDown={onPlaceCaret ? onKeyDown : undefined}
      tabIndex={onPlaceCaret ? 0 : undefined}
      role={onPlaceCaret ? "region" : undefined}
      aria-label={onPlaceCaret ? label : undefined}
    >
      <div
        className="diff-pane-content"
        style={
          contentWidth === undefined
            ? undefined
            : {
                minWidth: `max(100%, ${metrics.numberWidth * 2 + contentWidth}px)`,
              }
        }
      >
        {caretShown && caret && (
          <div
            className="diff-readonly-caret"
            aria-hidden="true"
            style={{
              top: (caretRow - offset) * LINE_HEIGHT,
              left: caretX,
            }}
          />
        )}
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
                <span
                  className="diff-fold-label"
                  style={{ left: metrics.numberWidth * 2 + 10 }}
                >
                  <span aria-hidden="true">▸ </span>
                  {entry.fold.hiddenLines} unchanged lines
                </span>
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
                    (entry.row.rightNumber ??
                      entry.row.leftNumber ??
                      0) as number
                  }${entry.row.chunkKind === "equal" ? "" : `, ${unifiedKindLabel(entry.row)}`}: `}
                </span>
                {/* Sticky, so the numbers hold their place while the text
                  scrolls under them; the second column parks after the first. */}
                <span
                  className="diff-unified-number"
                  style={{ width: metrics.numberWidth, left: 0 }}
                  aria-hidden="true"
                >
                  {entry.row.leftNumber ?? ""}
                </span>
                <span
                  className="diff-unified-number"
                  style={{
                    width: metrics.numberWidth,
                    left: metrics.numberWidth,
                  }}
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
    if (!merged.some((r) => r.start === range.start && r.end === range.end))
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
