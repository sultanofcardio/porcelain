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

export interface ChunkOptions {
  /** Treat lines differing only in leading/trailing whitespace as equal. */
  ignoreWhitespace?: boolean;
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
  const parts = diffLines(leftText, rightText, {
    ignoreWhitespace: options.ignoreWhitespace ?? false,
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
 */
function axisSpan(chunk: DiffChunk): number {
  return Math.max(chunk.left.count, chunk.right.count);
}

/** Total length of the shared scroll axis, in line-heights. */
export function axisLength(chunks: readonly DiffChunk[]): number {
  return chunks.reduce((total, chunk) => total + axisSpan(chunk), 0);
}

/**
 * Where one side sits when the shared axis is at `position`.
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
): number {
  if (chunks.length === 0) return Math.max(0, position);
  if (position <= 0) return 0;

  let axis = 0;
  for (const chunk of chunks) {
    const width = axisSpan(chunk);
    if (position < axis + width) {
      const target = span(chunk, side);
      const progress = width === 0 ? 0 : (position - axis) / width;
      return target.start + progress * target.count;
    }
    axis += width;
  }

  const last = span(chunks[chunks.length - 1], side);
  return last.start + last.count + (position - axis);
}

/**
 * The axis position that puts `line` of `side` at the top of its pane.
 *
 * Used for jumping — to a difference, a search hit, a click on the change
 * stripe — not for continuous scrolling, which drives the axis directly.
 * A line at the boundary of an insertion resolves to the far edge, so jumping
 * to it reveals the inserted lines rather than stopping short of them.
 */
export function sideToAxis(
  chunks: readonly DiffChunk[],
  line: number,
  side: Side,
): number {
  if (chunks.length === 0) return Math.max(0, line);
  if (line <= 0) return 0;

  let axis = 0;
  for (const chunk of chunks) {
    const width = axisSpan(chunk);
    const source = span(chunk, side);
    if (line < source.start + source.count) {
      const progress =
        source.count === 0 ? 0 : (line - source.start) / source.count;
      return axis + progress * width;
    }
    axis += width;
  }
  return axis;
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
