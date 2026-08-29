import type { DiffChunk, FoldRegion } from "../utils/diff-model";
import { chunkAxisSpan } from "../utils/diff-model";

/** One mark on the stripe, in axis units (or row units, in unified view). */
export interface StripeMark {
  start: number;
  span: number;
  kind: string;
}

/** The split view's marks: one per changed chunk, fold-aware. */
export function splitStripeMarks(
  chunks: readonly DiffChunk[],
  folds: readonly FoldRegion[] = [],
): StripeMark[] {
  const marks: StripeMark[] = [];
  let axis = 0;
  for (const [index, chunk] of chunks.entries()) {
    const width = chunkAxisSpan(chunks, index, folds);
    if (chunk.kind !== "equal") {
      marks.push({ start: axis, span: width, kind: chunk.kind });
    }
    axis += width;
  }
  return marks;
}

interface ChangeStripeProps {
  /** Length of the scroll range, in the same units as the marks. */
  total: number;
  marks: StripeMark[];
  axisPosition: number;
  visibleLines: number;
  /** Positions of find hits, already deduplicated by the caller. */
  matchPositions?: number[];
  onJump: (axisPosition: number) => void;
}

/**
 * Whole-file overview at the right edge: every change as a mark, plus the
 * viewport as a frame, so the size and spread of a review is visible without
 * scrolling through it.
 */
export function ChangeStripe({
  total,
  marks,
  axisPosition,
  visibleLines,
  matchPositions = [],
  onJump,
}: ChangeStripeProps) {
  const jump = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - bounds.top) / bounds.height;
    onJump(Math.max(0, fraction * total - visibleLines / 2));
  };

  return (
    // Deliberately decorative to the accessibility tree: everything the
    // stripe can do has a keyboard route — F7 steps differences, the find
    // bar jumps to matches, and the focused viewport scrolls natively — so
    // exposing a second, pixel-fiddly jump control would add noise, not
    // access.
    <div
      className="diff-stripe"
      onMouseDown={jump}
      role="presentation"
      aria-hidden="true"
    >
      {marks.map((mark) => (
        <span
          key={mark.start}
          className={`diff-stripe-mark diff-stripe-${mark.kind}`}
          style={{
            top: `${(mark.start / total) * 100}%`,
            // Floor at a visible size: a one-line change in a huge file would
            // otherwise round away to nothing, which is exactly when the
            // stripe is most useful.
            height: `${Math.max(0.4, (mark.span / total) * 100)}%`,
          }}
        />
      ))}
      {/* Find hits, narrower than the change marks so both stay readable
          when they overlap. Disproportionately useful: they show where the
          matches are in the file you have not scrolled through. */}
      {matchPositions.map((position) => (
        <span
          key={position}
          className="diff-stripe-found"
          style={{ top: `${(position / total) * 100}%` }}
        />
      ))}
      <span
        className="diff-stripe-viewport"
        style={{
          top: `${(axisPosition / total) * 100}%`,
          height: `${Math.min(100, (visibleLines / total) * 100)}%`,
        }}
      />
    </div>
  );
}
