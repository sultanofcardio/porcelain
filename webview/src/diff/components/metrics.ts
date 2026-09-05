import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { visualCol } from "../editor/editor-model";

/** Row height shared by both panes and the gutter, so they stay in step. */
export const LINE_HEIGHT = 20;

/** Inset of every row's text from the pane edge; `.diff-line`'s padding. */
export const PANE_TEXT_PADDING = 10;

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

/* ── the pane's horizontal geometry ─────────────────────────────────────── */

/** The cell width assumed until the font has been measured: Menlo at 12px. */
const DEFAULT_CHAR_WIDTH = 7.2;

/**
 * Width of one monospace cell in the *editor* font, in px — or null where
 * nothing can be measured (no canvas, as under jsdom).
 *
 * Measured from the `--editor-font` custom properties, never from the
 * element's computed font: the element inherits the app's UI font, and a cell
 * width taken from 13px sans-serif overshoots the mono rows' true width —
 * which drew the caret a few columns right of where edits actually landed,
 * growing with indent depth (the hand-test's "text is 4 places left of the
 * caret").
 */
export function measureCharWidth(element: Element): number | null {
  const style = window.getComputedStyle(element);
  const fontSize =
    style.getPropertyValue("--editor-font-size").trim() ||
    style.fontSize ||
    "12px";
  const fontFamily =
    style.getPropertyValue("--editor-font").trim() ||
    style.fontFamily ||
    "monospace";
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = `${fontSize} ${fontFamily}`;
  const measured = context.measureText("0").width;
  return measured > 0 ? measured : null;
}

/** The editor cell width, measured once from the element `ref` points at. */
export function useCharWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_CHAR_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measured = measureCharWidth(element);
    if (measured !== null) setWidth(measured);
  }, [ref]);
  return width;
}

/**
 * The widest line of a document, in visual cells: tabs expand to their stops
 * and a surrogate pair is one cell — the coordinate the editor's caret uses.
 * Every cell counts as one column, exact for the monospace rows; a pane also
 * sizes to whatever it actually renders (`.diff-pane-content`), so a wide
 * glyph on screen stays reachable even where the estimate falls short.
 */
export function widestLine(lines: readonly string[]): number {
  let widest = 0;
  for (const line of lines) {
    const cells = visualCol(line, line.length);
    if (cells > widest) widest = cells;
  }
  return widest;
}

/**
 * The scrollable width a pane needs for `columns` cells: the text inset on
 * the left and the same again on the right, so the widest line's end — and a
 * caret after it — never sits flush against the pane edge.
 */
export function paneContentWidth(columns: number, charWidth: number): number {
  return Math.ceil(PANE_TEXT_PADDING * 2 + columns * charWidth);
}
