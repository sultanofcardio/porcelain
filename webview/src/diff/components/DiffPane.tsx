import { type Ref, useCallback, useEffect, useMemo, useRef } from "react";
import { useShiki } from "../../shared/hooks/useShiki";
import {
  documentEnd,
  documentStart,
  lineEnd,
  lineStart,
  moveHorizontal,
  moveVertical,
  moveWord,
  type Position,
  visualCol,
} from "../editor/editor-model";
import {
  type ChunkKind,
  type DiffChunk,
  displayLine,
  displayLineCount,
  displayToSource,
  type FoldRegion,
  type Side,
} from "../utils/diff-model";
import type { FindMatch } from "../utils/find";
import {
  buildPieces,
  changedRanges,
  type Piece,
  syntaxSpans,
} from "../utils/highlight";
import { positionAt } from "../utils/positionAt";
import { LINE_HEIGHT, PANE_TEXT_PADDING, useCharWidth } from "./metrics";

interface DiffPaneProps {
  side: Side;
  lines: string[];
  /** The other side's lines, for word-level comparison within a chunk. */
  counterpart: string[];
  chunks: DiffChunk[];
  language: string;
  granularity: "line" | "word" | "character" | "none";
  /** Fractional display-row offset of the top of the viewport on this side. */
  offset: number;
  visibleLines: number;
  /** The folds currently collapsed. Empty means display rows are lines. */
  folds?: FoldRegion[];
  onToggleFold?: (fold: FoldRegion) => void;
  /** Find hits across both sides; the pane keeps only its own. */
  matches?: FindMatch[];
  /** The match the find stepper is on, when there is one. */
  activeMatch?: FindMatch | null;
  /**
   * Row colour overrides by source line. The merge surface paints conflict
   * regions over what the pair diff would say; anything absent falls back to
   * the chunk kind. An overridden row renders as a solid block — its
   * intraline marks are suppressed along with its chunk colour, since the
   * pair diff inside a region is noise.
   */
  overrideKinds?: ReadonlyMap<number, string>;
  /**
   * The chunks insertion anchors are drawn from, when they should differ
   * from the row source. The merge surface renders rows from the unfiltered
   * pair diff but anchors only from the region-filtered list — an anchor
   * slot is zero-count, so the row-keyed override map cannot suppress it.
   * Omitted, anchors follow `chunks`.
   */
  anchorChunks?: DiffChunk[];
  /**
   * Anchors the caller derives itself, drawn alongside the chunk-derived
   * ones. The merge result pane uses this for conflict regions that occupy
   * no rows there — nothing in the pair chunks can express them, since the
   * regions are filtered out of that list on purpose.
   */
  extraAnchors?: ReadonlyArray<{ line: number; kind: string }>;
  /**
   * The pane's own element, which is its horizontal scroll container - the
   * handle the shared horizontal axis (useHorizontalScroll) drives it by.
   */
  ref?: Ref<HTMLDivElement>;
  /**
   * The least scrollable width, in px, the pane offers whatever rows are on
   * screen. Only the visible window is rendered, so without it the sideways
   * range would grow and shrink with whichever lines happen to be in view.
   * Omitted, the pane is only as wide as its rendered rows.
   */
  contentWidth?: number;
  /** The pane scrolled sideways; `x` is its new scrollLeft. */
  onScrollX?: (x: number) => void;
  /**
   * A read-only caret. Every pane carries one, the way IntelliJ's diff does:
   * the pane takes focus on a click, the arrow keys walk the caret, and the
   * caret is the position Edit Source hands to the native editor. Nothing
   * edits through it. The editable side draws its own caret through
   * EditablePane and passes none here.
   */
  caret?: Position | null;
  onPlaceCaret?: (position: Position) => void;
  /** Scroll the surface so a display row sits inside the viewport. */
  onRevealRow?: (displayRow: number) => void;
  /** Accessible name for a pane that takes focus for its caret. */
  label?: string;
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
  folds = [],
  onToggleFold,
  matches = [],
  activeMatch = null,
  overrideKinds,
  anchorChunks,
  extraAnchors,
  ref,
  contentWidth,
  onScrollX,
  caret = null,
  onPlaceCaret,
  onRevealRow,
  label,
}: DiffPaneProps) {
  const highlighter = useShiki();

  // The pane's own element, for pointer geometry and the caret's cell width;
  // the caller's ref (the horizontal axis's handle) is forwarded alongside.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setHost = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const charWidth = useCharWidth(hostRef);
  const goalRef = useRef<number | null>(null);

  const toSourceLine = useCallback(
    (row: number) => {
      const source = displayToSource(folds, row, side);
      return source.kind === "line" ? source.line : null;
    },
    [folds, side],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (!host || !onPlaceCaret) return;
      // Fold rows are buttons with their own behaviour; buttons stay buttons.
      if ((event.target as HTMLElement).closest("button")) return;
      const bounds = host.getBoundingClientRect();
      // A press in the horizontal scrollbar's band belongs to the scrollbar.
      if (event.clientY >= bounds.top + host.clientHeight) return;
      const position = positionAt(event, {
        rect: bounds,
        offset,
        scrollX: host.scrollLeft,
        charWidth,
        toSourceLine,
        lines,
      });
      if (!position) return;
      // The default is left alone: native text selection still works on a
      // read-only pane, and focusing the pane is the default too.
      goalRef.current = null;
      onPlaceCaret(position);
    },
    [onPlaceCaret, offset, charWidth, toSourceLine, lines],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!caret || !onPlaceCaret) return;
      // A focused fold row keeps its own keys.
      if (event.target !== event.currentTarget) return;
      const primary = event.metaKey || event.ctrlKey;
      let next: Position;
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
        case "ArrowDown": {
          const delta = event.key === "ArrowUp" ? -1 : 1;
          if (primary) {
            next = delta < 0 ? documentStart() : documentEnd(lines);
            break;
          }
          const moved = moveVertical(lines, caret, delta, goalRef.current);
          next = moved.position;
          goal = moved.goalVisual;
          break;
        }
        case "Home":
          next = lineStart(caret);
          break;
        case "End":
          next = lineEnd(lines, caret);
          break;
        case "PageUp":
        case "PageDown": {
          const delta =
            (event.key === "PageUp" ? -1 : 1) * Math.max(1, visibleLines - 2);
          const moved = moveVertical(lines, caret, delta, goalRef.current);
          next = moved.position;
          goal = moved.goalVisual;
          break;
        }
        default:
          return;
      }
      goalRef.current = goal;
      event.preventDefault();
      // The viewport above scrolls on these keys; here the caret owns them.
      event.stopPropagation();
      onPlaceCaret(next);
    },
    [caret, onPlaceCaret, lines, visibleLines],
  );

  // Follow the caret: a move that leaves the viewport scrolls to it. Keyed
  // on the caret's identity alone, read through a ref, because scrolling
  // (which changes `offset`) must not re-trigger it. Nothing happens while
  // the viewport is unmeasured; the surface reveals the first change itself.
  const caretKey = caret ? `${caret.line}:${caret.col}` : null;
  const revealRef = useRef({ folds, side, offset, visibleLines, onRevealRow });
  revealRef.current = { folds, side, offset, visibleLines, onRevealRow };
  useEffect(() => {
    if (caretKey === null) return;
    const {
      folds: hidden,
      side: own,
      offset: at,
      visibleLines: rows,
      onRevealRow: go,
    } = revealRef.current;
    if (!go || rows === 0) return;
    const row = displayLine(hidden, Number(caretKey.split(":")[0]), own);
    if (row < at + 0.5 || row > at + rows - 1.5) {
      go(Math.max(0, row - Math.floor(rows / 2)));
    }
  }, [caretKey]);

  const caretRow = caret ? displayLine(folds, caret.line, side) : null;
  const caretShown =
    caret !== null &&
    caretRow !== null &&
    caretRow >= offset - 1 &&
    caretRow <= offset + visibleLines + 1;

  // Only the visible window is highlighted. Shiki tokenises per line, so the
  // cost tracks the viewport rather than the file, which is what keeps a
  // 20k-line diff from tokenising 20k lines to show forty of them.
  //
  // The window is a range of display rows, which are source lines exactly
  // when nothing is folded; `displayToSource` resolves each row to the line
  // it shows, or to the fold standing in for a hidden run.
  const first = Math.max(0, Math.floor(offset));
  const last = Math.min(
    displayLineCount(lines.length, folds),
    first + visibleLines + 2,
  );

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
    type RenderedRow =
      | { row: number; fold: FoldRegion }
      | { row: number; line: number; kind: ChunkKind; pieces: Piece[] };
    const rendered: RenderedRow[] = [];
    for (let row = first; row < last; row++) {
      const source = displayToSource(folds, row, side);
      if (source.kind === "fold") {
        rendered.push({ row, fold: source.fold });
        continue;
      }
      const index = source.line;
      const line = lines[index] ?? "";
      const chunk = chunkAt(chunks, side, index);
      const kind = chunk?.kind ?? "equal";

      let ranges: Array<{ start: number; end: number }> | null = [];
      if (kind === "modified" && !overrideKinds?.has(index)) {
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
        row,
        line: index,
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
    folds,
    overrideKinds,
  ]);

  // Only the anchors near the viewport: a large file has one per insertion,
  // and the rest would be DOM for nothing. Positions are display rows, so an
  // anchor below a fold sits where its line now renders.
  const anchors = [
    ...anchorsFor(anchorChunks ?? chunks, side),
    ...(extraAnchors ?? []),
  ]
    .map((anchor) => ({
      ...anchor,
      row: displayLine(folds, anchor.line, side),
    }))
    .filter(
      (anchor) =>
        anchor.row >= offset - 2 && anchor.row <= offset + visibleLines + 2,
    );

  return (
    <div
      className="diff-pane"
      ref={setHost}
      onScroll={(event) => onScrollX?.(event.currentTarget.scrollLeft)}
      onMouseDown={onPlaceCaret ? onMouseDown : undefined}
      onKeyDown={onPlaceCaret ? onKeyDown : undefined}
      // Only a pane with a caret takes focus: the keys above need somewhere
      // to land, and a screen reader needs a name for where it landed.
      tabIndex={onPlaceCaret ? 0 : undefined}
      aria-label={onPlaceCaret ? label : undefined}
    >
      {/* The scrollable extent (see diff.css): as wide as the widest rendered
          row, and never narrower than the whole document's widest line, so
          the scrollbar's range holds still while the rows beneath it change. */}
      <div
        className="diff-pane-content"
        style={
          contentWidth === undefined
            ? undefined
            : { minWidth: `max(100%, ${contentWidth}px)` }
        }
      >
        {caretShown && caret && caretRow !== null && (
          <div
            className="diff-readonly-caret"
            aria-hidden="true"
            style={{
              top: (caretRow - offset) * LINE_HEIGHT,
              left:
                PANE_TEXT_PADDING +
                visualCol(lines[caret.line] ?? "", caret.col) * charWidth,
            }}
          />
        )}
        {anchors.map((anchor) => (
          <div
            key={`anchor-${anchor.line}`}
            className={`diff-anchor diff-anchor-${anchor.kind}`}
            style={{ top: (anchor.row - offset) * LINE_HEIGHT }}
          />
        ))}
        <div
          className="diff-pane-lines"
          style={{
            transform: `translateY(${-(offset - first) * LINE_HEIGHT}px)`,
          }}
        >
          {rows.map((row) => {
            if ("fold" in row) {
              return (
                <button
                  key={row.row}
                  type="button"
                  className="diff-fold-row"
                  // The count carries the accessible name; the glyph is decor.
                  aria-label={`Expand ${row.fold.hiddenLines} unchanged lines`}
                  onClick={() => onToggleFold?.(row.fold)}
                >
                  <span className="diff-fold-label">
                    <span aria-hidden="true">▸ </span>
                    {row.fold.hiddenLines} unchanged lines
                  </span>
                </button>
              );
            }
            const kind = overrideKinds?.get(row.line) ?? row.kind;
            return (
              <div key={row.row} className={`diff-line diff-line-${kind}`}>
                {/* The row's state lives entirely in a background colour, which
                  a screen reader cannot see; this prefix is the audible
                  version, and takes no visual space. */}
                <span className="diff-sr-only">
                  {`Line ${row.line + 1}${kind === "equal" ? "" : `, ${kind}`}: `}
                </span>
                {row.pieces.length === 0
                  ? " "
                  : row.pieces.map((piece, i) => (
                      <span
                        // Pieces are positional slices of one line; there is no
                        // stable identity to key on beyond where they sit.
                        key={`${row.row}-${i}`}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
