/**
 * The pure heart of the hand-built editor core: positions, selections,
 * movement, text edits and history over a plain `string[]` document.
 *
 * Chosen at hand-test review over CodeMirror (a dependency and a second
 * rendering stack) and over a ghost textarea (which would forfeit folds in
 * the editable pane): the pane keeps rendering porcelain rows, and this
 * model plus a hidden input receiver and a drawn caret is the whole editor.
 *
 * Columns are UTF-16 code-unit offsets — the string's native coordinate —
 * but every movement steps by code point, so a caret can never land between
 * the halves of a surrogate pair. The visual coordinate (tabs expanded) is a
 * separate, explicit mapping.
 */

export interface Position {
  line: number;
  col: number;
}

/** A selection is two positions; the caret lives at `head`. */
export interface EditorSelection {
  anchor: Position;
  head: Position;
}

export function caretAt(line: number, col: number): EditorSelection {
  const at = { line, col };
  return { anchor: at, head: { ...at } };
}

export function isCaret(selection: EditorSelection): boolean {
  return (
    selection.anchor.line === selection.head.line &&
    selection.anchor.col === selection.head.col
  );
}

export function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}

/** The selection's endpoints in document order. */
export function ordered(selection: EditorSelection): {
  start: Position;
  end: Position;
} {
  return comparePositions(selection.anchor, selection.head) <= 0
    ? { start: selection.anchor, end: selection.head }
    : { start: selection.head, end: selection.anchor };
}

/** Snap a position into the document — after external splices, loads, undo. */
export function clampPosition(
  lines: readonly string[],
  position: Position,
): Position {
  if (lines.length === 0) return { line: 0, col: 0 };
  const line = Math.max(0, Math.min(lines.length - 1, position.line));
  const col = Math.max(0, Math.min(lines[line].length, position.col));
  return { line, col };
}

/* ── surrogate-safe horizontal stepping ─────────────────────────────────── */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The previous caret column on a line, stepping over a full code point. */
export function prevCol(text: string, col: number): number {
  if (col <= 0) return 0;
  if (
    col >= 2 &&
    isLowSurrogate(text.charCodeAt(col - 1)) &&
    isHighSurrogate(text.charCodeAt(col - 2))
  ) {
    return col - 2;
  }
  return col - 1;
}

/** The next caret column on a line, stepping over a full code point. */
export function nextCol(text: string, col: number): number {
  if (col >= text.length) return text.length;
  if (
    isHighSurrogate(text.charCodeAt(col)) &&
    col + 1 < text.length &&
    isLowSurrogate(text.charCodeAt(col + 1))
  ) {
    return col + 2;
  }
  return col + 1;
}

/* ── the visual coordinate (tabs) ───────────────────────────────────────── */

export const TAB_SIZE = 8;

/** How many character cells the first `col` units of a line occupy. */
export function visualCol(
  text: string,
  col: number,
  tabSize: number = TAB_SIZE,
): number {
  let visual = 0;
  for (let i = 0; i < col && i < text.length; i++) {
    if (text[i] === "\t") {
      visual += tabSize - (visual % tabSize);
      continue;
    }
    // The second half of a surrogate pair occupies no extra cell.
    if (isLowSurrogate(text.charCodeAt(i))) continue;
    visual += 1;
  }
  return visual;
}

/**
 * The caret column whose cell contains `visual` — for mouse clicks and for
 * vertical movement's goal column. Rounds to the nearer edge of the cell the
 * coordinate falls in, and never splits a surrogate pair.
 */
export function colAtVisual(
  text: string,
  visual: number,
  tabSize: number = TAB_SIZE,
): number {
  if (visual <= 0) return 0;
  let cells = 0;
  let col = 0;
  while (col < text.length) {
    const next = nextCol(text, col);
    const width =
      text[col] === "\t" ? tabSize - (cells % tabSize) : next - col > 0 ? 1 : 0;
    if (cells + width > visual) {
      // Inside this cell: snap to the nearer edge.
      return visual - cells >= width / 2 ? next : col;
    }
    cells += width;
    col = next;
  }
  return text.length;
}

/* ── movement ───────────────────────────────────────────────────────────── */

export function moveHorizontal(
  lines: readonly string[],
  position: Position,
  delta: -1 | 1,
): Position {
  const { line, col } = clampPosition(lines, position);
  const text = lines[line] ?? "";
  if (delta < 0) {
    if (col > 0) return { line, col: prevCol(text, col) };
    if (line > 0)
      return { line: line - 1, col: (lines[line - 1] ?? "").length };
    return { line, col };
  }
  if (col < text.length) return { line, col: nextCol(text, col) };
  if (line < lines.length - 1) return { line: line + 1, col: 0 };
  return { line, col };
}

/**
 * Vertical movement keeps a visual goal column across intervening short
 * lines — the column the user set out from, not the one they got clamped to.
 */
export function moveVertical(
  lines: readonly string[],
  position: Position,
  delta: number,
  goalVisual: number | null,
): { position: Position; goalVisual: number } {
  const { line, col } = clampPosition(lines, position);
  const goal = goalVisual ?? visualCol(lines[line] ?? "", col);
  const target = Math.max(0, Math.min(lines.length - 1, line + delta));
  if (target === line) {
    // Pinned at an edge: jump to the document boundary instead of nothing.
    if (delta < 0) return { position: { line: 0, col: 0 }, goalVisual: goal };
    const lastLine = lines.length - 1;
    return {
      position: { line: lastLine, col: (lines[lastLine] ?? "").length },
      goalVisual: goal,
    };
  }
  return {
    position: { line: target, col: colAtVisual(lines[target] ?? "", goal) },
    goalVisual: goal,
  };
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** One word-step: through any space, then through one run of like characters. */
export function moveWord(
  lines: readonly string[],
  position: Position,
  delta: -1 | 1,
): Position {
  let current = clampPosition(lines, position);
  const at = (p: Position): string => {
    const text = lines[p.line] ?? "";
    return delta < 0 ? text.slice(prevCol(text, p.col), p.col) : text[p.col];
  };
  const step = (p: Position) => moveHorizontal(lines, p, delta);
  const crossedLine = (a: Position, b: Position) => a.line !== b.line;

  // Skip whitespace. A line boundary is itself a stop: word-stepping off a
  // line's edge lands exactly across it, never mid-way into the next word.
  while (true) {
    const ch = at(current);
    const beyondLine = ch === undefined || ch === "";
    if (!beyondLine && !/\s/.test(ch)) break;
    const next = step(current);
    if (comparePositions(next, current) === 0) return current;
    if (crossedLine(next, current)) return next;
    current = next;
  }
  // Then one run of word or non-word characters.
  const first = at(current);
  if (first === undefined || first === "") return current;
  const inWord = WORD_CHAR.test(first);
  while (true) {
    const ch = at(current);
    if (ch === undefined || ch === "" || /\s/.test(ch)) break;
    if (WORD_CHAR.test(ch) !== inWord) break;
    const next = step(current);
    if (comparePositions(next, current) === 0 || crossedLine(next, current)) {
      return next;
    }
    current = next;
  }
  return current;
}

export function lineStart(position: Position): Position {
  return { line: position.line, col: 0 };
}

export function lineEnd(
  lines: readonly string[],
  position: Position,
): Position {
  const line = Math.max(0, Math.min(lines.length - 1, position.line));
  return { line, col: (lines[line] ?? "").length };
}

export function documentStart(): Position {
  return { line: 0, col: 0 };
}

export function documentEnd(lines: readonly string[]): Position {
  if (lines.length === 0) return { line: 0, col: 0 };
  const line = lines.length - 1;
  return { line, col: lines[line].length };
}

/* ── edits ──────────────────────────────────────────────────────────────── */

export interface AppliedEdit {
  lines: string[];
  caret: Position;
  /** The document range the edit replaced, in pre-edit coordinates. */
  replaced: { start: Position; end: Position };
  /** How many lines the document grew (+) or shrank (−). */
  lineDelta: number;
}

/**
 * Replace the selection with text — the one primitive every keystroke,
 * paste, composition commit, backspace and delete reduces to.
 */
export function applyTextEdit(
  lines: readonly string[],
  selection: EditorSelection,
  insertText: string,
): AppliedEdit {
  const doc = lines.length === 0 ? [""] : [...lines];
  const start = clampPosition(doc, ordered(selection).start);
  const end = clampPosition(doc, ordered(selection).end);

  const before = (doc[start.line] ?? "").slice(0, start.col);
  const after = (doc[end.line] ?? "").slice(end.col);
  const insert = insertText.split("\n");

  const replacedLineCount = end.line - start.line + 1;
  let caret: Position;
  if (insert.length === 1) {
    doc.splice(start.line, replacedLineCount, before + insert[0] + after);
    caret = { line: start.line, col: before.length + insert[0].length };
  } else {
    const middle = insert.slice(1, -1);
    const lastInsert = insert[insert.length - 1];
    doc.splice(
      start.line,
      replacedLineCount,
      before + insert[0],
      ...middle,
      lastInsert + after,
    );
    caret = {
      line: start.line + insert.length - 1,
      col: lastInsert.length,
    };
  }
  return {
    lines: doc,
    caret,
    replaced: { start, end },
    lineDelta: insert.length - replacedLineCount,
  };
}

/** What Backspace/Delete should remove when the selection is a bare caret. */
export function deletionRange(
  lines: readonly string[],
  selection: EditorSelection,
  direction: -1 | 1,
  word: boolean,
): EditorSelection {
  if (!isCaret(selection)) return selection;
  const head = clampPosition(lines, selection.head);
  const other = word
    ? moveWord(lines, head, direction)
    : moveHorizontal(lines, head, direction);
  return { anchor: other, head };
}

/* ── history ────────────────────────────────────────────────────────────── */

export interface HistorySnapshot {
  lines: string[];
  selection: EditorSelection;
}

const COALESCE_MS = 750;
const HISTORY_LIMIT = 200;

/**
 * Undo/redo over before-state snapshots. A run of single-character typing
 * shares one snapshot — undo takes the whole word back, the way every
 * editor's does — while structural acts (accepts, pastes, deletions) each
 * get their own. Snapshots hold shallow structures; strings are shared.
 *
 * Generic over the snapshot type: the diff surface remembers lines and a
 * selection, the merge surface also carries its conflict regions, and the
 * history neither knows nor cares.
 */
export class EditHistory<S = HistorySnapshot> {
  private past: S[] = [];
  private future: S[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  /** Record the state a mutation is about to replace. */
  record(before: S, key: string | null, at: number): void {
    const coalesces =
      key !== null && key === this.lastKey && at - this.lastAt < COALESCE_MS;
    this.lastKey = key;
    this.lastAt = at;
    this.future = [];
    if (coalesces) return;
    this.past.push(before);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  undo(current: S): S | null {
    const snapshot = this.past.pop();
    if (!snapshot) return null;
    this.future.push(current);
    this.lastKey = null;
    return snapshot;
  }

  redo(current: S): S | null {
    const snapshot = this.future.pop();
    if (!snapshot) return null;
    this.past.push(current);
    this.lastKey = null;
    return snapshot;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get depth(): number {
    return this.past.length;
  }
}
