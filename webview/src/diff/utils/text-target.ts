import { LINE_HEIGHT, PANE_TEXT_PADDING } from "../components/metrics";
import { colContaining, nextCol, visualCol } from "../editor/editor-model";
import type { Side } from "./diff-model";
import type { PointerGeometry } from "./positionAt";
import { rowAt } from "./positionAt";

/** A span of one line, as columns: `start` inclusive, `end` exclusive. */
export interface LineSpan {
  start: number;
  end: number;
}

/**
 * The word holding the character at `col`, where a word is a run of letters,
 * digits, `_` and `$`, the identifier characters of most languages. Null on
 * whitespace and punctuation: a pointer on the dot of `a.b` is on neither
 * name.
 */
export function wordAt(text: string, col: number): LineSpan | null {
  if (!isWordChar(text, col)) return null;
  let start = col;
  while (isWordChar(text, start - 1)) start--;
  let end = col + 1;
  while (isWordChar(text, end)) end++;
  return { start, end };
}

/**
 * The word at a caret: the one holding the character after it, or the one
 * ending right before it, the way an editor's word-at-position reads a caret
 * parked at the end of a name. Null between two non-word characters.
 */
export function wordAtCaret(text: string, col: number): LineSpan | null {
  return wordAt(text, col) ?? wordAt(text, col - 1);
}

function isWordChar(text: string, index: number): boolean {
  return index >= 0 && index < text.length && WORD_CHAR.test(text[index]);
}

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

/** Where something on a line is drawn, in client coordinates. */
export interface TextAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * What the pointer rests on: the character under it, the word around that
 * character, and where the word is drawn. What the hover card anchors to,
 * what a held modifier underlines, and what a modifier-click follows.
 */
export interface PointerTarget {
  side: Side;
  line: number;
  /** The character under the pointer. */
  col: number;
  /** The word around it, when it sits in one. */
  word: LineSpan | null;
  /** The word's box on screen, or the character's outside a word. */
  anchor: TextAnchor;
  /** Whether the platform's link modifier was held: Cmd, or Ctrl elsewhere. */
  modifier: boolean;
}

/**
 * The character under a pointer, or null over a fold row, past the end of
 * a line, and over the empty space below the last line. Unlike `positionAt`
 * this never snaps to a caret edge: a pointer between two characters is on
 * the one it covers.
 */
export function characterAt(
  event: { clientX: number; clientY: number },
  geometry: PointerGeometry,
): { line: number; col: number } | null {
  const {
    rect,
    scrollX,
    charWidth,
    toSourceLine,
    lines,
    textInset = PANE_TEXT_PADDING,
  } = geometry;
  const line = toSourceLine(rowAt(event, geometry));
  if (line === null || line >= lines.length) return null;
  const x = event.clientX - rect.left - textInset + scrollX;
  if (x < 0) return null;
  const col = colContaining(lines[line] ?? "", x / charWidth);
  return col === null ? null : { line, col };
}

/** The pointer's target on a pane, resolved through the pane's geometry. */
export function pointerTarget(
  event: {
    clientX: number;
    clientY: number;
    metaKey: boolean;
    ctrlKey: boolean;
  },
  geometry: PointerGeometry,
  side: Side,
): PointerTarget | null {
  const at = characterAt(event, geometry);
  if (!at) return null;
  const {
    rect,
    offset,
    scrollX,
    charWidth,
    lines,
    textInset = PANE_TEXT_PADDING,
  } = geometry;
  const text = lines[at.line] ?? "";
  const word = wordAt(text, at.col);
  const span = word ?? { start: at.col, end: nextCol(text, at.col) };
  const origin = rect.left + textInset - scrollX;
  const top = rect.top + (rowAt(event, geometry) - offset) * LINE_HEIGHT;
  return {
    side,
    line: at.line,
    col: at.col,
    word,
    anchor: {
      left: origin + visualCol(text, span.start) * charWidth,
      right: origin + visualCol(text, span.end) * charWidth,
      top,
      bottom: top + LINE_HEIGHT,
    },
    modifier: linkModifierHeld(event),
  };
}

/** Whether the platform's go-to-definition modifier is down on an event. */
export function linkModifierHeld(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}

/** The modifier's name for hints: what the platform calls the key. */
export function linkModifierName(): string {
  return isMac() ? "⌘" : "Ctrl";
}

function isMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}

/** A definition link drawn on one line of one side, under a held modifier. */
export interface LinkRange extends LineSpan {
  side: Side;
  line: number;
}
