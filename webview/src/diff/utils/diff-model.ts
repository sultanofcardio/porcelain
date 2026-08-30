import { diffLines } from "diff";

/**
 * The diff model behind the Porcelain diff surface.
 *
 * Two decisions shape everything here, both taken to match IntelliJ rather than
 * the native editor:
 *
 * 1. The panes are **not padded into alignment**. Each side renders its own
 *    lines continuously and keeps its own line numbers, so an unequal chunk
 *    makes the two sides drift apart. `mapLine` is what couples them.
 * 2. Chunks are joined by **curved connectors**, whose geometry is a pure
 *    function of where the chunk sits on each side — see `connectorPath`.
 */

export type ChunkKind = "equal" | "modified" | "added" | "removed";

/** Split keeping no trailing empty line, so line counts match the chunks'. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A half-open run of lines on one side, 0-based. */
export interface Span {
  start: number;
  count: number;
}

export interface DiffChunk {
  kind: ChunkKind;
  left: Span;
  right: Span;
}

/**
 * How whitespace differences are treated, matching IntelliJ's four modes:
 * none, trim leading/trailing, ignore all whitespace, and additionally
 * ignore lines that are empty on one side only.
 */
export type WhitespacePolicy = "none" | "trim" | "ignore" | "ignore-empty";

export interface ChunkOptions {
  /** Treat lines differing only in leading/trailing whitespace as equal. */
  ignoreWhitespace?: boolean;
  whitespace?: WhitespacePolicy;
}

/**
 * A side rewritten for comparison: the comparable lines joined for the diff
 * library, plus a map back to the real line each comparable line came from.
 *
 * Under "ignore" every line is whitespace-stripped and the map is the identity.
 * Under "ignore-empty" a line that is blank once whitespace is stripped is
 * dropped entirely, so a blank present on one side only never reaches the diff
 * and cannot read as an insertion; the map is what lets the chunks it produces
 * still address the real document by index, since the line count no longer
 * matches.
 */
interface ComparableSide {
  /** Comparable lines joined with trailing newline, or "" when none survive. */
  text: string;
  /** `map[k]` is the real line index of the k-th comparable line. */
  map: number[];
  /** The real line count of the original side. */
  total: number;
}

function comparableSide(
  text: string,
  policy: WhitespacePolicy,
): ComparableSide {
  const lines = splitLines(text);
  const kept: string[] = [];
  const map: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const normalized = lines[index].replace(/\s+/g, "");
    if (policy === "ignore-empty" && normalized === "") continue;
    kept.push(normalized);
    map.push(index);
  }
  return {
    text: kept.length === 0 ? "" : `${kept.join("\n")}\n`,
    map,
    total: lines.length,
  };
}

/**
 * The real line index at the boundary before comparable line `index`.
 *
 * Boundary 0 is the top of the file and boundary `map.length` is its end, so
 * dropped blank lines at either edge fold into the outermost chunk; a blank
 * dropped between two comparable lines folds into the chunk of the line above
 * it. The result is monotonic, which is what keeps the mapped spans tiling the
 * document without gaps or overlaps.
 */
function realBoundary(side: ComparableSide, index: number): number {
  if (index <= 0) return 0;
  if (index >= side.map.length) return side.total;
  return side.map[index];
}

/** A real-line span covering comparable lines [start, start+count) of a side. */
function mappedSpan(side: ComparableSide, start: number, count: number): Span {
  const from = realBoundary(side, start);
  return { start: from, count: realBoundary(side, start + count) - from };
}

/**
 * Chunks for the "ignore" / "ignore-empty" policies, diffed over normalized
 * copies while the spans address the real lines through each side's map.
 */
function computeNormalizedChunks(
  leftText: string,
  rightText: string,
  policy: WhitespacePolicy,
): DiffChunk[] {
  const left = comparableSide(leftText, policy);
  const right = comparableSide(rightText, policy);

  // Both sides reduced to nothing (e.g. two runs of blank lines under
  // "ignore-empty"): no comparable lines to diff, but the real lines still
  // exist and must read as one equal block rather than vanishing.
  if (left.map.length === 0 && right.map.length === 0) {
    if (left.total === 0 && right.total === 0) return [];
    return [
      {
        kind: "equal",
        left: { start: 0, count: left.total },
        right: { start: 0, count: right.total },
      },
    ];
  }

  const parts = diffLines(left.text, right.text);
  const chunks: DiffChunk[] = [];
  let leftLine = 0;
  let rightLine = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const count = part.count ?? 0;

    if (!part.added && !part.removed) {
      if (count > 0) {
        chunks.push({
          kind: "equal",
          left: mappedSpan(left, leftLine, count),
          right: mappedSpan(right, rightLine, count),
        });
      }
      leftLine += count;
      rightLine += count;
      continue;
    }

    if (part.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        const addedCount = next.count ?? 0;
        chunks.push({
          kind: "modified",
          left: mappedSpan(left, leftLine, count),
          right: mappedSpan(right, rightLine, addedCount),
        });
        leftLine += count;
        rightLine += addedCount;
        i++;
        continue;
      }
      chunks.push({
        kind: "removed",
        left: mappedSpan(left, leftLine, count),
        right: { start: realBoundary(right, rightLine), count: 0 },
      });
      leftLine += count;
      continue;
    }

    chunks.push({
      kind: "added",
      left: { start: realBoundary(left, leftLine), count: 0 },
      right: mappedSpan(right, rightLine, count),
    });
    rightLine += count;
  }

  return chunks;
}

/**
 * Split two documents into aligned chunks.
 *
 * A removal immediately followed by an addition is one `modified` chunk rather
 * than two, because that is the unit the connector and the difference count are
 * both defined over — reporting a one-line edit as two differences would make
 * the toolbar's count disagree with what the eye sees.
 */
export function computeChunks(
  leftText: string,
  rightText: string,
  options: ChunkOptions = {},
): DiffChunk[] {
  const policy: WhitespacePolicy =
    options.whitespace ?? (options.ignoreWhitespace ? "trim" : "none");
  // "ignore" and "ignore-empty" go beyond what the diff library offers, so
  // the comparison runs over normalized copies while the chunks still address
  // the real lines by index — "ignore-empty" additionally drops blank lines,
  // so its copies no longer share the real line count and need the index map.
  if (policy === "ignore" || policy === "ignore-empty") {
    return computeNormalizedChunks(leftText, rightText, policy);
  }
  const parts = diffLines(leftText, rightText, {
    ignoreWhitespace: policy === "trim",
  });

  const chunks: DiffChunk[] = [];
  let leftLine = 0;
  let rightLine = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const count = part.count ?? 0;

    if (!part.added && !part.removed) {
      if (count > 0) {
        chunks.push({
          kind: "equal",
          left: { start: leftLine, count },
          right: { start: rightLine, count },
        });
      }
      leftLine += count;
      rightLine += count;
      continue;
    }

    if (part.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        const addedCount = next.count ?? 0;
        chunks.push({
          kind: "modified",
          left: { start: leftLine, count },
          right: { start: rightLine, count: addedCount },
        });
        leftLine += count;
        rightLine += addedCount;
        i++; // the addition is folded into this chunk
        continue;
      }
      chunks.push({
        kind: "removed",
        left: { start: leftLine, count },
        right: { start: rightLine, count: 0 },
      });
      leftLine += count;
      continue;
    }

    chunks.push({
      kind: "added",
      left: { start: leftLine, count: 0 },
      right: { start: rightLine, count },
    });
    rightLine += count;
  }

  return chunks;
}

/** What the toolbar reports as "N differences". */
export function countDifferences(chunks: readonly DiffChunk[]): number {
  return chunks.filter((chunk) => chunk.kind !== "equal").length;
}

export type Side = "left" | "right";

function span(chunk: DiffChunk, side: Side): Span {
  return side === "left" ? chunk.left : chunk.right;
}

/**
 * How many units of the shared scroll axis a chunk occupies.
 *
 * The wider side wins, so an insertion still takes up room even though the
 * left side contributes nothing to it. That is what lets the right pane scroll
 * through an insertion while the left stands still.
 *
 * A folded chunk occupies its visible rows only: leading context, one fold
 * row, trailing context. That single definition is what makes the scrollbar,
 * the change stripe and both panes shrink together when a run collapses.
 */
function axisSpan(chunk: DiffChunk, fold?: FoldRegion): number {
  if (fold) return chunk.left.count - fold.hiddenLines + 1;
  return Math.max(chunk.left.count, chunk.right.count);
}

/**
 * How many display rows one side of a chunk contributes.
 *
 * Folds only land on equal chunks, where both sides have identical counts, so
 * a folded chunk's display count is the same on both sides — which is why the
 * drift machinery never has to know about folding.
 */
function displaySpanCount(
  chunk: DiffChunk,
  side: Side,
  fold?: FoldRegion,
): number {
  if (fold) return chunk.left.count - fold.hiddenLines + 1;
  return span(chunk, side).count;
}

/** The active folds, addressable by the chunk they collapse. */
function foldByChunk(
  folds: readonly FoldRegion[],
): Map<number, FoldRegion> | null {
  if (folds.length === 0) return null;
  const map = new Map<number, FoldRegion>();
  for (const fold of folds) map.set(fold.chunkIndex, fold);
  return map;
}

/**
 * `axisSpan` for one chunk of a chunk list, fold-aware. The change stripe
 * walks chunks itself to place its marks, and it has to shrink a folded
 * chunk exactly the way the axis does or the marks drift off their changes.
 */
export function chunkAxisSpan(
  chunks: readonly DiffChunk[],
  index: number,
  folds: readonly FoldRegion[] = [],
): number {
  const fold = folds.find((candidate) => candidate.chunkIndex === index);
  return axisSpan(chunks[index], fold);
}

/** Total length of the shared scroll axis, in line-heights. */
export function axisLength(
  chunks: readonly DiffChunk[],
  folds: readonly FoldRegion[] = [],
): number {
  const folded = foldByChunk(folds);
  return chunks.reduce(
    (total, chunk, index) => total + axisSpan(chunk, folded?.get(index)),
    0,
  );
}

/**
 * Where one side sits when the shared axis is at `position`, as a fractional
 * display row — which is a source line exactly when nothing is folded.
 *
 * Both panes are positioned from this single axis rather than from each other.
 * A direct left-to-right mapping cannot express the case the whole design turns
 * on — scrolling through an insertion, where the right advances five lines and
 * the left does not move at all — because the left position does not change
 * over that stretch, so it cannot be the input. The axis can.
 */
export function axisToSide(
  chunks: readonly DiffChunk[],
  position: number,
  side: Side,
  folds: readonly FoldRegion[] = [],
): number {
  if (chunks.length === 0) return Math.max(0, position);
  if (position <= 0) return 0;

  const folded = foldByChunk(folds);
  let axis = 0;
  let displayStart = 0;
  for (const [index, chunk] of chunks.entries()) {
    const fold = folded?.get(index);
    const width = axisSpan(chunk, fold);
    const count = displaySpanCount(chunk, side, fold);
    if (position < axis + width) {
      const progress = width === 0 ? 0 : (position - axis) / width;
      return displayStart + progress * count;
    }
    axis += width;
    displayStart += count;
  }

  return displayStart + (position - axis);
}

/**
 * How far to lift a side that is standing still, so its anchor sits in the
 * middle of the pane instead of at the very top.
 *
 * Scrolling through an insertion freezes the other side: `axisToSide` returns
 * the same display row for the whole chunk, and that row is the *top* of the
 * pane, so everything visible is what comes after the insertion point and the
 * context above it is pushed off screen. IntelliJ holds the anchor mid-pane
 * instead, keeping context on both sides of where the new lines go.
 *
 * The lift is a plateau, not a peak: it eases in over the half-viewport
 * *before* the gap, holds at full lift for the gap's whole length, and eases
 * back out over the half-viewport after it. Ramping in only once the gap has
 * been entered is what makes the stalled side visibly travel to the top of
 * the window and then slide back down to the middle — by then the anchor has
 * already reached the top and the lift is undoing it. Starting the ramp
 * early instead decelerates the side so it comes to rest mid-pane exactly as
 * the gap begins, waits there while the other side catches up, and moves off
 * again together.
 *
 * It is reported separately from the mapping itself because only continuous
 * scrolling wants it — jumping to a difference still wants the plain top.
 */
export function stallLift(
  chunks: readonly DiffChunk[],
  position: number,
  side: Side,
  viewportLines: number,
  folds: readonly FoldRegion[] = [],
): number {
  if (chunks.length === 0 || viewportLines <= 0 || position <= 0) return 0;

  const folded = foldByChunk(folds);
  const half = viewportLines / 2;
  const widths = chunks.map((chunk, index) =>
    axisSpan(chunk, folded?.get(index)),
  );
  // A chunk this side contributes no rows to is one it stands still through.
  const stalls = chunks.map(
    (chunk, index) => displaySpanCount(chunk, side, folded?.get(index)) === 0,
  );
  // A gap narrower than half a viewport cannot use a full lift: holding the
  // anchor further down than the gap is deep would push the side backwards
  // past what standing still can justify.
  const peakOf = (index: number) => Math.min(half, widths[index]);

  // Where each chunk begins on the axis, so distances can be measured across
  // however many chunks lie between here and a gap.
  const starts: number[] = [];
  let axis = 0;
  for (const width of widths) {
    starts.push(axis);
    axis += width;
  }
  const current = chunks.findIndex(
    (_, index) => position < starts[index] + widths[index],
  );
  if (current === -1) return 0;
  if (stalls[current]) return peakOf(current);

  // The ramp is measured in axis lines to the gap, not within one chunk. A
  // gap is often preceded by a very short run — an insertion two lines below
  // an edit leaves only the two lines between them — and ramping inside that
  // run alone gives the side no room to slow down: it reaches the top at
  // full speed and is then snapped back to the middle, which is the bounce
  // this replaced. Scanning across chunks lets the deceleration begin as far
  // ahead as it needs to.
  let ahead = Number.POSITIVE_INFINITY;
  let peakAhead = 0;
  for (let index = current + 1; index < chunks.length; index++) {
    if (stalls[index]) {
      ahead = starts[index] - position;
      peakAhead = peakOf(index);
      break;
    }
  }
  let behind = Number.POSITIVE_INFINITY;
  let peakBehind = 0;
  for (let index = current - 1; index >= 0; index--) {
    if (stalls[index]) {
      behind = position - (starts[index] + widths[index]);
      peakBehind = peakOf(index);
      break;
    }
  }

  let lift = 0;
  if (peakAhead > 0) {
    lift = Math.max(lift, peakAhead * (1 - Math.min(ahead, half) / half));
  }
  if (peakBehind > 0) {
    lift = Math.max(lift, peakBehind * (1 - Math.min(behind, half) / half));
  }
  // Two gaps closer together than the ramp leave nowhere to go in between:
  // the side would bob up mid-run only to be pushed straight back down. It
  // stays parked at the lower of the two plateaus instead.
  if (peakAhead > 0 && peakBehind > 0 && ahead + behind < half) {
    lift = Math.max(lift, Math.min(peakAhead, peakBehind));
  }
  return lift;
}

/**
 * The axis position that puts `line` of `side` at the top of its pane.
 *
 * Used for jumping — to a difference, a search hit, a click on the change
 * stripe — not for continuous scrolling, which drives the axis directly.
 * A line at the boundary of an insertion resolves to the far edge, so jumping
 * to it reveals the inserted lines rather than stopping short of them.
 * A line hidden inside a fold resolves to the fold's own row; expanding it
 * first is the caller's decision, not this function's.
 */
export function sideToAxis(
  chunks: readonly DiffChunk[],
  line: number,
  side: Side,
  folds: readonly FoldRegion[] = [],
): number {
  if (chunks.length === 0) return Math.max(0, line);
  if (line <= 0) return 0;

  const folded = foldByChunk(folds);
  const display = displayLine(folds, line, side);
  let axis = 0;
  let displayStart = 0;
  for (const [index, chunk] of chunks.entries()) {
    const fold = folded?.get(index);
    const width = axisSpan(chunk, fold);
    const count = displaySpanCount(chunk, side, fold);
    if (display < displayStart + count) {
      const progress = count === 0 ? 0 : (display - displayStart) / count;
      return axis + progress * width;
    }
    axis += width;
    displayStart += count;
  }
  return axis;
}

/**
 * Where a source line sits once the folds above it have collapsed.
 *
 * A fold hides its run and contributes one row in its place, so lines below
 * shift up by `hiddenLines - 1` per fold passed, and a line inside a hidden
 * run maps to the fold's own row. With no folds this is the identity, which
 * is why the panes' existing arithmetic survives unchanged.
 */
export function displayLine(
  folds: readonly FoldRegion[],
  line: number,
  side: Side,
): number {
  let shift = 0;
  for (const fold of folds) {
    const hidden = side === "left" ? fold.left : fold.right;
    if (line >= hidden.start + hidden.count) {
      shift += hidden.count - 1;
      continue;
    }
    if (line >= hidden.start) return hidden.start - shift;
    break;
  }
  return line - shift;
}

export type DisplayRow =
  | { kind: "line"; line: number }
  | { kind: "fold"; fold: FoldRegion };

/**
 * What one display row of one side shows: a source line, or a fold standing
 * in for its hidden run. The inverse of `displayLine`.
 */
export function displayToSource(
  folds: readonly FoldRegion[],
  row: number,
  side: Side,
): DisplayRow {
  let shift = 0;
  for (const fold of folds) {
    const hidden = side === "left" ? fold.left : fold.right;
    const foldRow = hidden.start - shift;
    if (row < foldRow) return { kind: "line", line: row + shift };
    if (row === foldRow) return { kind: "fold", fold };
    shift += hidden.count - 1;
  }
  return { kind: "line", line: row + shift };
}

/** How many display rows one side has in total. */
export function displayLineCount(
  lineCount: number,
  folds: readonly FoldRegion[],
): number {
  return folds.reduce(
    (total, fold) => total - (fold.hiddenLines - 1),
    lineCount,
  );
}

export interface FoldRegion {
  /** Index into the chunk list of the equal chunk being folded. */
  chunkIndex: number;
  left: Span;
  right: Span;
  /** How many lines the fold hides, after context is subtracted. */
  hiddenLines: number;
}

export interface FoldOptions {
  /** Lines of unchanged context kept either side of a fold. */
  contextLines?: number;
  /**
   * The shortest equal run worth folding. Folding a run barely longer than its
   * own context trades scrolling for a click and reads as noise.
   */
  minimumLines?: number;
}

/**
 * The unchanged runs long enough to be worth collapsing.
 *
 * A run at the very start or end of the file keeps context only on its inner
 * edge, since there is nothing beyond the other one to give context to.
 */
export function computeFolds(
  chunks: readonly DiffChunk[],
  options: FoldOptions = {},
): FoldRegion[] {
  const context = options.contextLines ?? 3;
  const minimum = options.minimumLines ?? context * 2 + 2;
  const folds: FoldRegion[] = [];

  for (const [index, chunk] of chunks.entries()) {
    if (chunk.kind !== "equal") continue;
    // A blank ignored under "ignore-empty" can leave an equal chunk with more
    // lines on one side; the fold machinery collapses both sides in lockstep,
    // so an uneven equal run must not fold or the shorter side would drift.
    if (chunk.left.count !== chunk.right.count) continue;
    if (chunk.left.count < minimum) continue;

    const leadingContext = index === 0 ? 0 : context;
    const trailingContext = index === chunks.length - 1 ? 0 : context;
    const hidden = chunk.left.count - leadingContext - trailingContext;
    if (hidden <= 0) continue;

    folds.push({
      chunkIndex: index,
      left: { start: chunk.left.start + leadingContext, count: hidden },
      right: { start: chunk.right.start + leadingContext, count: hidden },
      hiddenLines: hidden,
    });
  }

  return folds;
}

export type DiffLayout = { mode: "split" } | { mode: "single"; side: Side };

/**
 * How to lay the diff out.
 *
 * A file that was added has nothing on the left, and one that was deleted has
 * nothing on the right. Showing the empty side anyway spends half the window
 * on a blank column and puts a connector between content and nothing, so those
 * collapse to the one side that has content.
 */
export function chooseLayout(left: string, right: string): DiffLayout {
  if (left === "" && right !== "") return { mode: "single", side: "right" };
  if (right === "" && left !== "") return { mode: "single", side: "left" };
  return { mode: "split" };
}

export interface ConnectorEdges {
  /** Top and bottom of the chunk on the left side, in pixels. */
  ay0: number;
  ay1: number;
  /** Top and bottom of the chunk on the right side, in pixels. */
  by0: number;
  by1: number;
}

export interface ConnectorBand {
  /** Total gutter width. */
  width: number;
  /** Where the bend is allowed to start and finish. */
  gapStart: number;
  gapEnd: number;
  /**
   * Thinnest the band is allowed to get, in pixels.
   *
   * A side with no lines would otherwise collapse to zero height and the fill
   * would paint nothing along it, so the connector pinched out of existence
   * exactly where it met the insertion marker. Holding a floor keeps the band
   * continuous from one pane to the other.
   */
  minThickness?: number;
}

/** Widen an edge pair symmetrically until it is at least `minimum` tall. */
function atLeast(
  y0: number,
  y1: number,
  minimum: number,
): readonly [number, number] {
  const deficit = minimum - (y1 - y0);
  if (deficit <= 0) return [y0, y1];
  const half = deficit / 2;
  return [y0 - half, y1 + half];
}

/**
 * The SVG path joining one chunk across the gutter.
 *
 * Three segments per edge: a flat run out to the gap, a cubic Bézier across it,
 * then a flat run to the far side. Confining the slope to the gap is what keeps
 * a connector from sweeping across the line numbers — over a tall chunk a curve
 * spanning the whole gutter passes straight through both columns.
 *
 * Control points sit at the middle of the gap, so each curve leaves and arrives
 * horizontally and meets its flat runs without a corner. Insertions and
 * deletions are not special-cased: they are the degenerate forms where one pair
 * of edges collapses to a point.
 */
export function connectorPath(
  edges: ConnectorEdges,
  band: ConnectorBand,
): string {
  const { width, gapStart, gapEnd, minThickness = 0 } = band;
  const [ay0, ay1] = atLeast(edges.ay0, edges.ay1, minThickness);
  const [by0, by1] = atLeast(edges.by0, edges.by1, minThickness);
  const mid = (gapStart + gapEnd) / 2;
  return (
    `M0 ${ay0} ` +
    `L${gapStart} ${ay0} ` +
    `C${mid} ${ay0} ${mid} ${by0} ${gapEnd} ${by0} ` +
    `L${width} ${by0} ` +
    `L${width} ${by1} ` +
    `L${gapEnd} ${by1} ` +
    `C${mid} ${by1} ${mid} ${ay1} ${gapStart} ${ay1} ` +
    `L0 ${ay1} Z`
  );
}
