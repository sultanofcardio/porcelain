import type { DiffChunk, FoldRegion } from "../utils/diff-model";
import { axisLength, chunkAxisSpan } from "../utils/diff-model";

interface ChangeStripeProps {
  chunks: DiffChunk[];
  axisPosition: number;
  visibleLines: number;
  /** The folds currently collapsed — the marks shrink with the axis. */
  folds?: FoldRegion[];
  /** Axis positions of find hits, already deduplicated by the caller. */
  matchPositions?: number[];
  onJump: (axisPosition: number) => void;
}

/**
 * Whole-file overview at the right edge: every change as a mark, plus the
 * viewport as a frame, so the size and spread of a review is visible without
 * scrolling through it.
 */
export function ChangeStripe({
  chunks,
  axisPosition,
  visibleLines,
  folds = [],
  matchPositions = [],
  onJump,
}: ChangeStripeProps) {
  const total = axisLength(chunks, folds) || 1;

  const marks: Array<{
    key: number;
    top: number;
    height: number;
    kind: string;
  }> = [];
  let axis = 0;
  for (const [index, chunk] of chunks.entries()) {
    const width = chunkAxisSpan(chunks, index, folds);
    if (chunk.kind !== "equal") {
      marks.push({
        key: index,
        top: (axis / total) * 100,
        // Floor at a visible size: a one-line change in a huge file would
        // otherwise round away to nothing, which is exactly when the stripe is
        // most useful.
        height: Math.max(0.4, (width / total) * 100),
        kind: chunk.kind,
      });
    }
    axis += width;
  }

  const jump = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - bounds.top) / bounds.height;
    onJump(Math.max(0, fraction * total - visibleLines / 2));
  };

  return (
    <div
      className="diff-stripe"
      onMouseDown={jump}
      role="presentation"
      aria-hidden="true"
    >
      {marks.map((mark) => (
        <span
          key={mark.key}
          className={`diff-stripe-mark diff-stripe-${mark.kind}`}
          style={{ top: `${mark.top}%`, height: `${mark.height}%` }}
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
