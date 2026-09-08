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
  /**
   * Where a row's text starts inside the pane, in px. The split panes keep
   * their numbers in the gutter beside them, so their text starts at the
   * padding; a unified row carries both number columns in front of its own
   * text and passes their width along with it.
   */
  textInset?: number;
}

/** The display row under a pointer, clamped to the first row. */
export function rowAt(
  event: { clientY: number },
  geometry: { rect: { top: number }; offset: number },
): number {
  const { rect, offset } = geometry;
  return Math.max(
    0,
    Math.floor(offset + (event.clientY - rect.top) / LINE_HEIGHT),
  );
}

/**
 * Whether a caret on display row `row` sits outside the rows the viewport is
 * showing, so following it means scrolling.
 *
 * `offset` is the row drawn flush with the top, fractional only while a
 * trackpad has left the view between two rows, so that row is fully visible
 * and never worth scrolling to. The bottom keeps half a row of slack: a
 * viewport is rarely a whole number of rows high, and the last row it draws
 * can be clipped.
 */
export function needsReveal(
  row: number,
  offset: number,
  visibleLines: number,
): boolean {
  return row < Math.floor(offset) || row > offset + visibleLines - 1.5;
}

/**
 * The (line, column) under a pointer, or null over a fold row and over the
 * empty space below a pane that shows no line at all.
 *
 * One geometry for every pane: the editable side's caret, the read-only
 * carets, the unified view's caret, and the hover target all resolve a
 * pointer the same way, so a click and a hover on the same pixel name the
 * same character. Rows are fold-aware through `toSourceLine`; columns step by
 * visual cell, so tabs and wide glyphs land where they are drawn.
 */
export function positionAt(
  event: { clientX: number; clientY: number },
  geometry: PointerGeometry,
): Position | null {
  const {
    rect,
    scrollX,
    charWidth,
    toSourceLine,
    lines,
    textInset = PANE_TEXT_PADDING,
  } = geometry;
  const row = rowAt(event, geometry);
  let line = toSourceLine(row);
  if (line === null) return null;
  if (lines.length === 0) return { line: 0, col: 0 };
  if (line >= lines.length) {
    // Past the content: the caret goes to the last line the pane shows,
    // not to the file's last line. The two differ when a fold hides the
    // file's tail, and putting the caret on a hidden line would open the
    // whole run for a click on empty space. The walk back is bounded by the
    // rows between the click and the content, so by the viewport's height.
    line = null;
    for (let above = row - 1; above >= 0 && line === null; above--) {
      const candidate = toSourceLine(above);
      if (candidate !== null && candidate < lines.length) line = candidate;
    }
    if (line === null) return null;
  }
  const x = event.clientX - rect.left - textInset + scrollX;
  const col = colAtVisual(lines[line] ?? "", Math.max(0, x / charWidth));
  return { line, col };
}
