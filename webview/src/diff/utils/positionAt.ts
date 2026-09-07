import { LINE_HEIGHT, PANE_TEXT_PADDING } from "../components/metrics";
import { colAtVisual, type Position } from "../editor/editor-model";

export interface PointerGeometry {
  /** The pane's bounding box, in client coordinates. */
  rect: { top: number; left: number };
  /** Fractional display-row offset of the viewport top on this pane. */
  offset: number;
  /** How far the pane is scrolled sideways, in px. */
  scrollX: number;
  /** Width of one monospace cell, in px. */
  charWidth: number;
  /** The source line a display row shows, or null on a fold row. */
  toSourceLine: (row: number) => number | null;
  lines: readonly string[];
}

/**
 * The (line, column) under a pointer, or null over a fold row.
 *
 * One geometry for every pane: the editable side's caret, the read-only
 * carets, and the hover target all resolve a pointer the same way, so a
 * click and a hover on the same pixel name the same character. Rows are
 * fold-aware through `toSourceLine`; columns step by visual cell, so tabs
 * and wide glyphs land where they are drawn.
 */
export function positionAt(
  event: { clientX: number; clientY: number },
  geometry: PointerGeometry,
): Position | null {
  const { rect, offset, scrollX, charWidth, toSourceLine, lines } = geometry;
  const row = Math.floor(offset + (event.clientY - rect.top) / LINE_HEIGHT);
  const line = toSourceLine(Math.max(0, row));
  if (line === null) return null;
  if (lines.length === 0) return { line: 0, col: 0 };
  const clamped = Math.min(line, lines.length - 1);
  const x = event.clientX - rect.left - PANE_TEXT_PADDING + scrollX;
  const col = colAtVisual(lines[clamped] ?? "", Math.max(0, x / charWidth));
  return { line: clamped, col };
}
