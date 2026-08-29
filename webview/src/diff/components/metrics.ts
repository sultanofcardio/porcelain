/** Row height shared by both panes and the gutter, so they stay in step. */
export const LINE_HEIGHT = 20;

/**
 * The centre gutter is three bands: a line-number column for each side, and a
 * gap between them.
 *
 * The gap exists so a connector can do all of its bending inside it. A curve
 * that sweeps across the whole gutter crosses the line numbers on its way,
 * which makes both harder to read; confining the slope to the middle keeps the
 * numbers on clean horizontal runs.
 */
export const GUTTER_GAP = 24;

/** Column padding plus per-digit width at the gutter's 11px monospace. */
const NUMBER_PADDING = 12;
const DIGIT_WIDTH = 7;

export interface GutterMetrics {
  numberWidth: number;
  gapStart: number;
  gapEnd: number;
  width: number;
}

/**
 * Gutter geometry for a file whose larger side has `maxLineNumber` lines.
 *
 * Sized from the actual line count rather than fixed: a hardcoded column is
 * tuned for some number of digits and crowds past it. Floored at four digits
 * so short files keep the familiar proportions, and never narrowing beyond
 * that floor.
 */
export function gutterMetrics(maxLineNumber: number): GutterMetrics {
  const digits = Math.max(4, String(Math.max(1, maxLineNumber)).length);
  const numberWidth = Math.max(26, digits * DIGIT_WIDTH + NUMBER_PADDING);
  return {
    numberWidth,
    gapStart: numberWidth,
    gapEnd: numberWidth + GUTTER_GAP,
    width: numberWidth * 2 + GUTTER_GAP,
  };
}
