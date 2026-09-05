import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { TAB_SIZE, visualCol } from "../editor/editor-model";

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
  const context = editorContext(element);
  if (!context) return null;
  const measured = context.measureText("0").width;
  return measured > 0 ? measured : null;
}

/** A canvas context set to the editor face the rows render in, or null. */
function editorContext(element: Element): CanvasRenderingContext2D | null {
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
  return context;
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

/** Measures one line of text as the pane renders it, in px. */
export type LineMeasurer = (line: string) => number;

/**
 * How many measured lines a measurer remembers. Emptied rather than evicted
 * one by one: the cache exists so that editing re-measures only the line that
 * changed, and starting over costs one scan of the lines still on screen.
 */
const MEASURE_CACHE_LIMIT = 20000;

/**
 * A measurer for the rows of the pane `element` belongs to, or null where
 * nothing can be measured (no canvas, as under jsdom).
 *
 * Widths are remembered by line text. The width of a document is recomputed
 * on every keystroke of an editable side, and every line but the edited one
 * comes back identical.
 */
export function createLineMeasurer(element: Element): LineMeasurer | null {
  const context = editorContext(element);
  if (!context) return null;
  // CSS defines `tab-size` against the space advance, and no stylesheet here
  // overrides its default of eight.
  const tabWidth = TAB_SIZE * context.measureText(" ").width;
  const widths = new Map<string, number>();
  return (line) => {
    const remembered = widths.get(line);
    if (remembered !== undefined) return remembered;
    const width = measureLine(context, line, tabWidth);
    if (widths.size >= MEASURE_CACHE_LIMIT) widths.clear();
    widths.set(line, width);
    return width;
  };
}

/**
 * The rendered width of one `white-space: pre` row, in px.
 *
 * A tab is a stop in *rendered* space: the browser advances to the next
 * multiple of the tab width, which is only the next multiple of eight cells
 * while every glyph before it is one cell wide. Measuring the row segment by
 * segment and snapping in px keeps the two in step on a row that mixes tabs
 * with glyphs wider than a cell, where writing the tabs out as cell-space
 * spaces would come out short by the difference.
 */
function measureLine(
  context: CanvasRenderingContext2D,
  line: string,
  tabWidth: number,
): number {
  if (!line.includes("\t")) return context.measureText(line).width;
  const segments = line.split("\t");
  let width = context.measureText(segments[0]).width;
  for (const segment of segments.slice(1)) {
    // A tab landing exactly on a stop still advances a whole tab width.
    if (tabWidth > 0) width = (Math.floor(width / tabWidth) + 1) * tabWidth;
    width += context.measureText(segment).width;
  }
  return width;
}

/** The measurer for the pane `ref` points at, created once. */
export function useLineMeasurer(
  ref: RefObject<HTMLElement | null>,
): LineMeasurer | null {
  const [measure, setMeasure] = useState<LineMeasurer | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const created = createLineMeasurer(element);
    if (created) setMeasure(() => created);
  }, [ref]);
  return measure;
}

/**
 * How much wider than its cell estimate one row can render. A cell is one
 * ASCII advance; a full-width East Asian glyph takes two, an emoji a little
 * more, and nothing in a monospace face goes past this.
 */
const WIDE_GLYPH_FACTOR = 2.5;

/** Whether every code unit of `line` advances by exactly one cell width. */
function isAscii(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

/**
 * The rendered width of a document's widest row, in px.
 *
 * Cells alone are not it: `visualCol` counts a full-width East Asian glyph as
 * one cell where the row paints two, so a CJK document estimated at
 * `widestLine * charWidth` would come out at half its width — and the
 * `max-content` fallback would then lift whichever pane happens to be
 * rendering that row past the shared range, breaking the panes' lockstep at
 * exactly the point the estimate ran out.
 *
 * An ASCII row is not one of those: every code unit below 0x80 advances by
 * one cell in the monospace face the caret coordinate already assumes, so
 * `cells * charWidth` is its width exactly and it is never measured. That
 * leaves only the rows carrying something else as candidates, ranked by cell
 * count, of which one is measured only while `cells * charWidth *
 * WIDE_GLYPH_FACTOR` can still beat the widest width found — so a document
 * of code measures nothing at all, and a document with a wide-glyph comment
 * measures that comment. Without a measurer the cell estimate is all there
 * is.
 */
export function widestLineWidth(
  lines: readonly string[],
  charWidth: number,
  measure: LineMeasurer | null,
): number {
  if (!measure) return widestLine(lines) * charWidth;
  let widest = 0;
  const candidates: { line: string; cells: number }[] = [];
  for (const line of lines) {
    const cells = visualCol(line, line.length);
    if (isAscii(line)) {
      widest = Math.max(widest, cells * charWidth);
      continue;
    }
    candidates.push({ line, cells });
  }
  candidates.sort((a, b) => b.cells - a.cells);
  for (const { line, cells } of candidates) {
    if (cells * charWidth * WIDE_GLYPH_FACTOR <= widest) break;
    const width = measure(line);
    if (width > widest) widest = width;
  }
  return widest;
}

/**
 * The scrollable width a pane needs for text `textWidth` px wide: the text
 * inset on the left and the same again on the right, so the widest line's
 * end — and a caret after it — never sits flush against the pane edge.
 */
export function paneContentWidth(textWidth: number): number {
  return PANE_TEXT_PADDING * 2 + Math.ceil(textWidth);
}
