import {
  type FoldEnd,
  type FoldRegion,
  type FoldStep,
  foldStep,
} from "../utils/diff-model";

interface FoldRowProps {
  fold: FoldRegion;
  /** Which end of the hidden run the next click opens; see `revealEnd`. */
  end: FoldEnd;
  onReveal?: (fold: FoldRegion) => void;
  /**
   * The pane's visible width, in px. The row is pinned to the pane's left
   * edge and sized to its viewport, so the separator spans what is on screen
   * and the count stays centred however far the text is scrolled sideways.
   * Unknown (before the first measure, or in a test), it fills its container.
   */
  width?: number;
  /**
   * Px of columns parked at the pane's left edge that the row starts after:
   * the unified view's line numbers. Nothing for the split panes.
   */
  inset?: number;
}

/** The hint's wording for the next step: "Show 4 lines", "Show all 29 lines". */
export function foldStepLabel(step: FoldStep): string {
  return step.rest
    ? `Show all ${step.lines} lines`
    : `Show ${step.lines} lines`;
}

/**
 * The row's accessible name: the next step, where its lines will appear
 * relative to the row, and how much the row still hides. Head lines appear
 * above the separator (it moves down), tail lines below it.
 */
export function foldRowName(fold: FoldRegion, step: FoldStep): string {
  const where = step.end === "head" ? "above" : "below";
  if (step.rest) {
    return `Show all ${fold.hiddenLines} unchanged lines ${where}`;
  }
  return `Show ${step.lines} of ${fold.hiddenLines} unchanged lines ${where}`;
}

/**
 * One collapsed run of unchanged lines, IntelliJ's way: a wavy separator
 * carrying the hidden count, which a click opens in stages (4 lines, 8 more,
 * then the rest) from the end nearest the caret. The whole row is the click
 * target; hovering tints the edge the lines will appear on and names the
 * step. One 20 px row per pane, so the axis arithmetic is untouched.
 */
export function FoldRow({
  fold,
  end,
  onReveal,
  width,
  inset = 0,
}: FoldRowProps) {
  const step = foldStep(fold, end);
  return (
    <button
      type="button"
      className={`diff-fold-row diff-fold-row-${end}`}
      aria-label={foldRowName(fold, step)}
      onClick={() => onReveal?.(fold)}
      style={{
        width: width ? width : undefined,
        paddingLeft: inset + 12,
      }}
    >
      <span className="diff-fold-wave" aria-hidden="true" />
      <span className="diff-fold-count" aria-hidden="true">
        {fold.hiddenLines} unchanged lines
      </span>
      <span className="diff-fold-after" aria-hidden="true">
        <span className="diff-fold-wave" />
        <span className="diff-fold-hint">{foldStepLabel(step)}</span>
      </span>
    </button>
  );
}
