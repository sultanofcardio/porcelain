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
export const GUTTER_NUMBER_WIDTH = 26;
export const GUTTER_GAP = 24;
export const GUTTER_GAP_START = GUTTER_NUMBER_WIDTH;
export const GUTTER_GAP_END = GUTTER_NUMBER_WIDTH + GUTTER_GAP;
export const GUTTER_WIDTH = GUTTER_NUMBER_WIDTH * 2 + GUTTER_GAP;
