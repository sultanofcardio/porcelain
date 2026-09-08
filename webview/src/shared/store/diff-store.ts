import { create } from "zustand";
import {
  applyTextEdit,
  caretAt,
  clampPosition,
  EditHistory,
  type EditorSelection,
  isCaret,
  ordered,
  type Position,
} from "../../diff/editor/editor-model";
import {
  applyReveals,
  axisLength,
  type ChunkOptions,
  computeChunks,
  computeFolds,
  countDifferences,
  counterpartLine,
  type DiffChunk,
  displayLine,
  type FoldEnd,
  type FoldRegion,
  type FoldReveal,
  firstChangeLine,
  foldStep,
  revealEnd,
  type Side,
  sideToAxis,
  splitLines,
} from "../../diff/utils/diff-model";
import { DEFAULT_EDITOR_SETTINGS } from "../../diff/utils/editor-settings";
import { type FindMatch, sideMatches } from "../../diff/utils/find";
import {
  unifiedChunkRow,
  unifiedRowOf,
  unifiedRows,
} from "../../diff/utils/unified";
import {
  type DiffSidesResult,
  type EditorSettings,
  WORKING_TREE_REF,
} from "../bridge/types";

/**
 * What the viewer shows instead of text panes. `null` means an ordinary text
 * diff; everything else is the host's verdict that the content is not
 * line-diffable, carried verbatim so the placeholder can say why.
 */
export type DiffFallbackInfo =
  | { kind: "binary"; leftBytes: number; rightBytes: number; differs: boolean }
  | {
      kind: "image";
      leftUri?: string;
      rightUri?: string;
      leftBytes: number;
      rightBytes: number;
    }
  | { kind: "tooLarge"; lines: number; limit: number }
  | { kind: "unreadable"; reason: string };

/** How much of a changed line is highlighted within the line. */
export type Granularity = "line" | "word" | "character" | "none";

export type Whitespace = "none" | "trim" | "ignore" | "ignore-empty";

/**
 * Side-by-side or one column. Unified is a second row-builder over the same
 * chunks, folds and find state — nothing else in the store is mode-aware.
 */
export type ViewMode = "split" | "unified";

/**
 * View state for one open diff.
 *
 * Every option here is per-window and non-persistent by design — that is the
 * thing the native editor structurally cannot offer, since its `diffEditor.*`
 * settings are global and survive the window closing.
 */
export interface DiffStoreState {
  left: string;
  right: string;
  filePath: string;
  leftRef: string;
  rightRef: string;
  /** Display labels from the host, which owns how content is addressed. */
  leftLabel: string;
  rightLabel: string;
  language: string;
  loading: boolean;
  error: string | null;
  /** Non-null when the host classified the content as not line-diffable. */
  fallback: DiffFallbackInfo | null;

  chunks: DiffChunk[];
  /** The folds currently collapsed — computed regions minus expanded ones. */
  folds: FoldRegion[];
  /** Keys of folds the user has expanded. */
  expandedFolds: ReadonlySet<number>;
  /**
   * Folds opened part of the way, by key: how many lines each has given up
   * at its head and at its tail. A fold opens in steps from the end nearest
   * the caret, the way IntelliJ's do, and this is the state between steps.
   */
  foldReveals: ReadonlyMap<number, FoldReveal>;
  differences: number;
  /** Length of the shared scroll axis, in line-heights. */
  axis: number;

  whitespace: Whitespace;
  granularity: Granularity;
  syncScroll: boolean;
  collapseUnchanged: boolean;
  contextLines: number;
  swapped: boolean;
  viewMode: ViewMode;
  /** Index into `chunks` of the difference the toolbar last stepped to. */
  activeChunk: number;

  /**
   * Find state — searched against the store's full texts, never the DOM.
   * The panes are virtualised to roughly a viewport of rows, which is what
   * rules out the webview's native find widget: it would silently match only
   * what happens to be on screen.
   *
   * One state per side, the IntelliJ shape: each pane carries its own find
   * bar with its own query, options and match walk. `activeFindSide` names
   * the bar that last acted — its current match is the one wearing the box.
   */
  findOpen: boolean;
  findLeft: SideFindState;
  findRight: SideFindState;
  activeFindSide: Side | null;

  /**
   * Editing — exposed only where a side can own a buffer, which is exactly
   * the sides addressed as the working tree (decision 2 of the merge scope
   * review). Everything here is inert when `editableSide()` is null.
   */
  cursor: EditorSelection | null;
  goalVisual: number | null;
  composition: { start: Position; endLine: number; recorded: boolean } | null;
  /** Undo/redo over the editable side, typing runs coalesced. */
  history: EditHistory<DiffEditSnapshot>;
  canUndo: boolean;
  canRedo: boolean;
  /** The editable side's text differs from what was last loaded or saved. */
  dirty: boolean;
  /** What the disk held at load/save time — the baseline `dirty` compares to. */
  savedText: string | null;
  /** The file changed on disk while there are unsaved edits. */
  diskChanged: boolean;
  /**
   * Why the last write to disk failed, kept apart from `error`, which is
   * about loading the diff. A save that succeeds clears it.
   */
  saveError: string | null;
  setSaveError: (message: string | null) => void;
  /**
   * The VS Code settings the surface honours, as the host forwards them:
   * seeded from the webview's data-* payload, replaced on `configChanged`.
   */
  settings: EditorSettings;
  setSettings: (settings: EditorSettings) => void;

  /**
   * Carets on the read-only sides. Every pane carries a caret, the way
   * IntelliJ's diff does, placed on the first changed line when the diff
   * opens: it is the position Edit Source hands to the native editor, and
   * the point a fold opens away from. The editable side's caret is `cursor`;
   * its entry here stays null.
   */
  readOnlyCarets: Record<Side, Position | null>;
  /** The pane clicked or keyed last: whose caret Edit Source hands over. */
  activePane: Side | null;
  /** Put a pane's caret somewhere, and make that pane the active one. */
  placeCaret: (side: Side, position: Position) => void;

  /** Place the cursor; folds hiding it expand so the caret is never invisible. */
  setCursor: (
    selection: EditorSelection | null,
    goalVisual?: number | null,
  ) => void;
  /** The one editing primitive: replace `selection` with `text`. */
  editAt: (
    selection: EditorSelection,
    text: string,
    coalesceKey: string | null,
  ) => void;
  /** IME composition: one lazy history step, live replaces until end. */
  beginComposition: () => void;
  updateComposition: (text: string) => void;
  endComposition: (text: string) => void;
  undo: () => void;
  redo: () => void;
  /** Record what was actually written to disk as the new dirty baseline. */
  markSaved: (content: string) => void;
  setDiskChanged: (changed: boolean) => void;

  setSides: (sides: DiffSidesResult) => void;
  setError: (message: string | null) => void;
  setWhitespace: (value: Whitespace) => void;
  setGranularity: (value: Granularity) => void;
  toggleSyncScroll: () => void;
  toggleCollapseUnchanged: () => void;
  /**
   * Collapse every unchanged region again, or expand them all. Distinct from
   * the feature toggle: with collapsing on and some folds hand-expanded,
   * "collapse" must re-collapse those rather than turn the feature off.
   */
  setCollapsed: (collapsed: boolean) => void;
  setContextLines: (value: number) => void;
  setViewMode: (mode: ViewMode) => void;
  /** Expand or re-collapse one fold whole, identified by its key. */
  toggleFold: (key: number) => void;
  /**
   * Open a fold one step further from the end nearest the active pane's
   * caret. Reports what that did to the reference caret, in the rows the
   * pane carrying it renders: rows revealed above it push its line down, and
   * only the caller knows how its scrollers turn a pane row into a position.
   */
  revealFold: (key: number) => FoldRevealShift;
  swapSides: () => void;
  stepDifference: (delta: number) => void;
  /** Axis position that reveals the active difference, or null when there is none. */
  activeChunkAxis: () => number | null;

  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (side: Side, query: string) => void;
  toggleFindCase: (side: Side) => void;
  toggleFindWord: (side: Side) => void;
  toggleFindRegex: (side: Side) => void;
  /** Move one side's bar to its next (+1) or previous (-1) match, wrapping. */
  stepMatch: (side: Side, delta: number) => void;
  /**
   * Expand the fold hiding one side's active match, if one does. Jumping to
   * a match the viewer then cannot show would make the count read as a lie.
   */
  revealActiveMatch: (side: Side) => void;
  /** Position that reveals one side's active match, in the current view's scroll units. */
  activeMatchAxis: (side: Side) => number | null;
}

/** One find bar's whole world: query, options, and its walk through the hits. */
export interface SideFindState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  matches: FindMatch[];
  /** Index into `matches`, or -1 when there is none. */
  activeMatch: number;
  /**
   * Bumped by user-initiated find actions only — typing, option toggles,
   * stepping. The bar's reveal-and-scroll keys on this, so a buffer splice
   * that recomputes the match list cannot yank the viewport.
   */
  revealSeq: number;
}

const EMPTY_SIDE_FIND: SideFindState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  matches: [],
  activeMatch: -1,
  revealSeq: 0,
};

/**
 * Which side owns a buffer: the one addressed as the file on disk, and only
 * that one. Historical refs cannot be edited into rewritten commits, and the
 * index side stays read-only — staging hunks is `git add -p` territory, not a
 * text editor. Derived from the refs rather than stored, so Swap Sides cannot
 * leave it stale.
 */
export function editableSide(state: {
  leftRef: string;
  rightRef: string;
}): Side | null {
  if (state.rightRef === WORKING_TREE_REF) return "right";
  if (state.leftRef === WORKING_TREE_REF) return "left";
  return null;
}

/**
 * Where every caret starts: the first changed line on each side. The
 * editable side's caret is the editor's `cursor`; the others are read-only
 * carets. The active pane is the editable one, or the right pane when
 * nothing can be edited, so Edit Source has an answer before any click.
 */
function initialCarets(
  chunks: readonly DiffChunk[],
  text: { left: string; right: string },
  editable: Side | null,
  hasText: boolean,
): Pick<DiffStoreState, "cursor" | "readOnlyCarets" | "activePane"> {
  if (!hasText) {
    return {
      cursor: null,
      readOnlyCarets: { left: null, right: null },
      activePane: null,
    };
  }
  const at = (side: Side): Position => ({
    line: firstChangeLine(
      chunks,
      side,
      splitLines(side === "left" ? text.left : text.right).length,
    ),
    col: 0,
  });
  return {
    cursor: editable ? caretAt(at(editable).line, 0) : null,
    readOnlyCarets: {
      left: editable === "left" ? null : at("left"),
      right: editable === "right" ? null : at("right"),
    },
    activePane: editable ?? (text.right !== "" ? "right" : "left"),
  };
}

/**
 * The carets a reload of the *same* document keeps, clamped into the text
 * that just arrived, or null when there were none to keep.
 *
 * A quiet refresh (a formatter rewriting the file under a clean diff) must
 * leave every caret exactly where the reader put it: the pane follow effects
 * key on caret identity alone, so re-placing carets on the new first change
 * would scroll the view out from under them.
 */
function keptCarets(
  state: Pick<DiffStoreState, "cursor" | "readOnlyCarets" | "activePane">,
  text: { left: string; right: string },
  editable: Side | null,
): Pick<DiffStoreState, "cursor" | "readOnlyCarets" | "activePane"> | null {
  const { cursor, readOnlyCarets } = state;
  if (!cursor && !readOnlyCarets.left && !readOnlyCarets.right) return null;
  const linesOf = (side: Side) =>
    splitLines(side === "left" ? text.left : text.right);
  const keep = (side: Side) => {
    const caret = readOnlyCarets[side];
    if (!caret || editable === side) return null;
    return clampPosition(linesOf(side), caret);
  };
  const head =
    editable && cursor ? clampPosition(linesOf(editable), cursor.head) : null;
  return {
    cursor: head ? caretAt(head.line, head.col) : null,
    readOnlyCarets: { left: keep("left"), right: keep("right") },
    activePane: state.activePane,
  };
}

/** Where a diff's three carets live, whichever way they were placed. */
type PaneCarets = Pick<
  DiffStoreState,
  "cursor" | "readOnlyCarets" | "activePane"
>;

/**
 * A fold derivation with every caret still visible: any run that would hide
 * the editable cursor or a read-only caret is expanded and the derivation
 * redone. `placeCaret` and `setCursor` keep that invariant when a caret
 * moves; this is how it survives the fold list being rebuilt underneath one
 * that did not.
 *
 * `place` is for the paths that put the carets somewhere new from the chunks
 * this derivation computes, which is what a load and a swap both do: the
 * carets it returns are part of the result, checked against the folds like
 * any others.
 */
function deriveVisibleFolds(
  state: Parameters<typeof derive>[0] & Parameters<typeof foldsHidingCarets>[1],
  place?: (chunks: DiffChunk[]) => PaneCarets,
) {
  const derived = derive(state);
  const placed = place?.(derived.chunks);
  const carets = placed ? { ...state, ...placed } : state;
  const hiding = foldsHidingCarets(derived.folds, carets);
  if (hiding.length === 0) {
    return {
      expandedFolds: state.expandedFolds,
      foldReveals: state.foldReveals,
      ...derived,
      ...placed,
    };
  }
  const expansion = expandFolds(state, hiding);
  return {
    ...expansion,
    ...derive({ ...state, ...expansion }),
    ...placed,
  };
}

/**
 * The fold state with `keys` opened whole. An expanded fold has no partial
 * reveal to remember: dropping its entry is what lets a later re-collapse
 * bring the run back complete, and what keeps the toolbar's "everything is
 * folded" reading honest.
 */
function expandFolds(
  state: Pick<DiffStoreState, "expandedFolds" | "foldReveals">,
  keys: Iterable<number>,
): Pick<DiffStoreState, "expandedFolds" | "foldReveals"> {
  const expandedFolds = new Set(state.expandedFolds);
  const foldReveals = new Map(state.foldReveals);
  for (const key of keys) {
    expandedFolds.add(key);
    foldReveals.delete(key);
  }
  return { expandedFolds, foldReveals };
}

/**
 * The expansion keys of the folds that would hide a caret, using the same
 * containment `placeCaret` and `setCursor` apply. A caret must never sit on
 * hidden content, so a reload that keeps carets has to reopen these runs.
 */
function foldsHidingCarets(
  folds: readonly FoldRegion[],
  state: Pick<
    DiffStoreState,
    "leftRef" | "rightRef" | "cursor" | "readOnlyCarets"
  >,
): number[] {
  const keys: number[] = [];
  for (const fold of folds) {
    for (const side of ["left", "right"] as const) {
      const caret = caretOn(state, side);
      if (!caret) continue;
      const hidden = side === "left" ? fold.left : fold.right;
      if (
        caret.line >= hidden.start &&
        caret.line < hidden.start + hidden.count
      ) {
        keys.push(fold.key);
        break;
      }
    }
  }
  return keys;
}

/**
 * The scroll position that brings one chunk into view, in whatever units the
 * current view scrolls in: a unified row, or a position on the shared axis.
 * Null when there is no such chunk, or the unified row list hides it whole.
 *
 * The one place the axis-for-a-chunk rule lives: the toolbar's stepper and
 * the load-time reveal both read it here.
 */
export function chunkAxis(
  state: Pick<DiffStoreState, "chunks" | "folds" | "viewMode">,
  index: number,
): number | null {
  const { chunks, folds, viewMode } = state;
  const chunk = chunks[index];
  if (!chunk) return null;
  if (viewMode === "unified") {
    const row = unifiedChunkRow(unifiedRows(chunks, folds), index);
    return row >= 0 ? row : null;
  }
  const side = chunk.right.count > 0 ? "right" : "left";
  const span = side === "right" ? chunk.right : chunk.left;
  return sideToAxis(chunks, span.start, side, folds);
}

/** The caret of one pane, whichever kind it is. */
export function caretOn(
  state: Pick<
    DiffStoreState,
    "leftRef" | "rightRef" | "cursor" | "readOnlyCarets"
  >,
  side: Side,
): Position | null {
  if (editableSide(state) === side) return state.cursor?.head ?? null;
  return state.readOnlyCarets[side];
}

/** The pane whose caret folds open away from: the one acted in last. */
export function referencePane(
  state: Pick<DiffStoreState, "leftRef" | "rightRef" | "activePane">,
): Side {
  return state.activePane ?? editableSide(state) ?? "right";
}

/**
 * Which end of a fold the next click opens, for the fold rows to name and
 * tint their next step: the end nearest the active pane's caret.
 */
export function foldRevealEnd(
  state: Pick<
    DiffStoreState,
    "leftRef" | "rightRef" | "cursor" | "readOnlyCarets" | "activePane"
  >,
  fold: FoldRegion,
): FoldEnd {
  const side = referencePane(state);
  return revealEnd(fold, side, caretOn(state, side)?.line ?? null);
}

/** What a staged reveal did to the reference caret, in rendered pane rows. */
export interface FoldRevealShift {
  /** The pane whose caret the reveal opened away from. */
  pane: Side;
  /** The row that caret was rendered on before the reveal; null with none. */
  caretRow: number | null;
  /** How many rows the reveal pushed that caret down. */
  rows: number;
}

/**
 * Which row of its own pane the reference caret renders on: a row of the
 * unified list, or a display row of the split pane. What a staged reveal
 * compares before and after, so the caller can keep that caret's line still
 * while rows appear above it.
 *
 * Deliberately not an axis position: the axis maps to pane rows at a slope
 * that varies chunk by chunk (zero across a side's gap), so an axis delta is
 * not the row delta the caret actually moved by.
 */
function caretDisplayRow(
  state: Pick<
    DiffStoreState,
    | "leftRef"
    | "rightRef"
    | "cursor"
    | "readOnlyCarets"
    | "chunks"
    | "folds"
    | "viewMode"
  >,
  side: Side,
): number | null {
  const caret = caretOn(state, side);
  if (!caret) return null;
  if (state.viewMode === "unified") {
    const row = unifiedRowOf(
      unifiedRows(state.chunks, state.folds),
      side,
      caret.line,
    );
    return Math.max(0, row);
  }
  return displayLine(state.folds, caret.line, side);
}

/**
 * Where Edit Source opens the file: the active pane's caret, expressed on
 * the working-tree side. A read-only caret maps across through the chunks;
 * inside a changed chunk the lines do not pair, so the column is dropped.
 * With no working-tree side at all the caret is handed over as it is, which
 * is the best guess for a file that has since moved on.
 */
export function editSourcePosition(
  state: Pick<
    DiffStoreState,
    | "leftRef"
    | "rightRef"
    | "cursor"
    | "readOnlyCarets"
    | "activePane"
    | "chunks"
    | "fallback"
    | "loading"
    | "left"
    | "right"
  >,
): { line: number; column: number } | null {
  if (state.fallback || state.loading) return null;
  const editable = editableSide(state);
  const side = referencePane(state);
  const caret = caretOn(state, side);
  if (!caret) return null;
  if (editable === null || editable === side) {
    return { line: caret.line, column: caret.col };
  }
  const twin = counterpartLine(state.chunks, side, caret.line, {
    left: splitLines(state.left),
    right: splitLines(state.right),
  });
  return { line: twin.line, column: twin.exact ? caret.col : 0 };
}

function chunkOptionsFor(whitespace: Whitespace): ChunkOptions {
  return { whitespace };
}

/** Where a buffer splice happened, for shifting line-keyed state below it. */
export interface LineSplice {
  /** First line the splice replaced. */
  start: number;
  /** First line past the replaced run, in pre-splice numbering. */
  end: number;
  /** How many lines the document grew (or shrank) by. */
  delta: number;
}

/**
 * Shift line-number keys past a splice by its delta, so state keyed on line
 * numbers (expanded folds) keeps naming the same content after the buffer
 * moves underneath it.
 */
export function remapLineKeys(
  keys: ReadonlySet<number>,
  splice: LineSplice,
): ReadonlySet<number> {
  if (splice.delta === 0 || keys.size === 0) return keys;
  const remapped = new Set<number>();
  for (const key of keys) remapped.add(shiftLineKey(key, splice));
  return remapped;
}

/** `remapLineKeys` for state that carries a value per key (partial reveals). */
export function remapLineKeyMap<V>(
  map: ReadonlyMap<number, V>,
  splice: LineSplice,
): ReadonlyMap<number, V> {
  if (splice.delta === 0 || map.size === 0) return map;
  const remapped = new Map<number, V>();
  for (const [key, value] of map) {
    remapped.set(shiftLineKey(key, splice), value);
  }
  return remapped;
}

function shiftLineKey(key: number, splice: LineSplice): number {
  return key >= splice.end ? key + splice.delta : key;
}

/** Mirror a fallback's per-side facts, for Swap Sides. */
function swapFallback(
  fallback: DiffFallbackInfo | null,
): DiffFallbackInfo | null {
  if (!fallback) return null;
  if (fallback.kind === "binary") {
    return {
      ...fallback,
      leftBytes: fallback.rightBytes,
      rightBytes: fallback.leftBytes,
    };
  }
  if (fallback.kind === "image") {
    return {
      ...fallback,
      leftUri: fallback.rightUri,
      rightUri: fallback.leftUri,
      leftBytes: fallback.rightBytes,
      rightBytes: fallback.leftBytes,
    };
  }
  // tooLarge and unreadable carry nothing per-side.
  return fallback;
}

/** Recompute everything derived from the two texts and the current options. */
function derive(state: {
  left: string;
  right: string;
  whitespace: Whitespace;
  collapseUnchanged: boolean;
  contextLines: number;
  expandedFolds: ReadonlySet<number>;
  foldReveals: ReadonlyMap<number, FoldReveal>;
}) {
  const chunks = computeChunks(
    state.left,
    state.right,
    chunkOptionsFor(state.whitespace),
  );
  // `folds` holds only the folds currently collapsed, each shrunk by what
  // has been revealed of it. Both are keyed on the hidden run's starting
  // left line, not on chunkIndex: toggling whitespace re-chunks the file and
  // shifts every index, and an expanded fold that silently became a
  // different expanded fold would be a bug the user could not even describe.
  const folds = state.collapseUnchanged
    ? applyReveals(
        computeFolds(chunks, { contextLines: state.contextLines }).filter(
          (fold) => !state.expandedFolds.has(fold.key),
        ),
        state.foldReveals,
      )
    : [];
  return {
    chunks,
    differences: countDifferences(chunks),
    axis: axisLength(chunks, folds),
    folds,
  };
}

/**
 * Recompute one bar's match list from its side's text and options.
 *
 * Runs on every keystroke without debouncing: the tooLarge gate caps text
 * diffs at 25k lines, and a substring scan over that is single-digit
 * milliseconds. The first match becomes active so typing jumps to it, which
 * is what every editor's find does.
 */
function recomputeSide(
  text: string,
  side: Side,
  sideState: SideFindState,
  open: boolean,
  splice?: LineSplice,
): SideFindState {
  const matches =
    open && sideState.query !== ""
      ? sideMatches(splitLines(text), side, sideState.query, {
          caseSensitive: sideState.caseSensitive,
          wholeWord: sideState.wholeWord,
          regex: sideState.regex,
        })
      : [];
  // A recompute driven by a buffer splice must not reset the user's stepped
  // position: the previous active match is re-located by (line, start) —
  // with its line first shifted by the splice's delta when it sat at or
  // below the splice, or the relocation would lock onto whatever occurrence
  // now happens to sit at the old coordinates.
  const previous = sideState.matches[sideState.activeMatch];
  const anchor =
    previous && splice && previous.line >= splice.start
      ? { line: previous.line + splice.delta, start: previous.start }
      : previous;
  const relocated = anchor
    ? matches.findIndex(
        (match) => match.line === anchor.line && match.start === anchor.start,
      )
    : -1;
  return {
    ...sideState,
    matches,
    activeMatch: relocated >= 0 ? relocated : matches.length > 0 ? 0 : -1,
  };
}

/** Both bars, refreshed against the current texts. */
function deriveFind(
  state: {
    left: string;
    right: string;
    findOpen: boolean;
    findLeft: SideFindState;
    findRight: SideFindState;
  },
  splice?: LineSplice & { side: Side },
) {
  return {
    findLeft: recomputeSide(
      state.left,
      "left",
      state.findLeft,
      state.findOpen,
      splice?.side === "left" ? splice : undefined,
    ),
    findRight: recomputeSide(
      state.right,
      "right",
      state.findRight,
      state.findOpen,
      splice?.side === "right" ? splice : undefined,
    ),
  };
}

export const useDiffStore = create<DiffStoreState>((set, get) => ({
  left: "",
  right: "",
  filePath: "",
  leftRef: "",
  rightRef: "",
  leftLabel: "",
  rightLabel: "",
  language: "plaintext",
  loading: true,
  error: null,
  fallback: null,

  chunks: [],
  folds: [],
  expandedFolds: new Set<number>(),
  foldReveals: new Map<number, FoldReveal>(),
  differences: 0,
  axis: 0,

  whitespace: "none",
  granularity: "word",
  syncScroll: true,
  collapseUnchanged: true,
  contextLines: 3,
  swapped: false,
  viewMode: "split",
  activeChunk: -1,

  findOpen: false,
  findLeft: EMPTY_SIDE_FIND,
  findRight: EMPTY_SIDE_FIND,
  activeFindSide: null,

  cursor: null,
  goalVisual: null,
  composition: null,
  history: new EditHistory<DiffEditSnapshot>(),
  canUndo: false,
  canRedo: false,
  dirty: false,
  savedText: null,
  diskChanged: false,
  saveError: null,
  setSaveError: (saveError) => set({ saveError }),
  settings: DEFAULT_EDITOR_SETTINGS,
  setSettings: (settings) => set({ settings }),
  readOnlyCarets: { left: null, right: null },
  activePane: null,

  placeCaret: (side, position) => {
    const state = get();
    if (state.fallback || state.loading) return;
    if (editableSide(state) === side) {
      // The editable side's caret is the editor's own.
      state.setCursor(caretAt(position.line, position.col));
      return;
    }
    const lines = splitLines(side === "left" ? state.left : state.right);
    const caret = clampPosition(lines, position);
    // A caret must never sit on hidden content: expand the fold whose span
    // on this side holds it, as setCursor does for the editable side.
    const hiding = state.folds.find((fold) => {
      const hidden = side === "left" ? fold.left : fold.right;
      return (
        caret.line >= hidden.start && caret.line < hidden.start + hidden.count
      );
    });
    let expansion = {};
    if (hiding) {
      const opened = expandFolds(state, [hiding.key]);
      expansion = { ...opened, ...derive({ ...state, ...opened }) };
    }
    set({
      readOnlyCarets: { ...state.readOnlyCarets, [side]: caret },
      activePane: side,
      ...expansion,
    });
  },

  setSides: (sides) =>
    set((state) => {
      const { kind, filePath, leftRef, rightRef, leftLabel, rightLabel } =
        sides;
      const meta = {
        filePath,
        leftRef,
        rightRef,
        leftLabel,
        rightLabel,
        language: sides.language,
        loading: false,
        error: null,
        // Fresh content is a new answer to the question the failure was
        // about, whether it arrived from Reload from disk or a probe.
        saveError: null,
        activeChunk: -1,
        // Fresh content arrives unswapped — a reload after Swap Sides must
        // not leave the flag lying about what the panes show.
        swapped: false,
      };
      const text =
        kind === "text"
          ? { left: sides.left, right: sides.right, fallback: null }
          : // Nothing to chunk: the placeholder carries the host's verdict,
            // and the derived state empties so the toolbar and stripe go
            // quiet.
            { left: "", right: "", fallback: sides };
      // Fresh content resets the whole editing story: the baseline is what
      // just arrived, and history over the old text would splice garbage.
      const editable = editableSide({ leftRef, rightRef });
      const editing = {
        cursor: null,
        goalVisual: null,
        composition: null,
        history: new EditHistory<DiffEditSnapshot>(),
        canUndo: false,
        canRedo: false,
        dirty: false,
        savedText:
          kind === "text" && editable
            ? editable === "left"
              ? text.left
              : text.right
            : null,
        diskChanged: false,
      };
      // The same document arriving again is a refresh, not a new diff: the
      // carets stay where they were, and so do the runs the reader opened.
      // Anything else starts both over: what was expanded in another diff
      // has no meaning in this one.
      const sameDocument =
        state.filePath === filePath &&
        state.leftRef === leftRef &&
        state.rightRef === rightRef;
      const carets =
        kind === "text" && sameDocument
          ? keptCarets(state, text, editable)
          : null;
      const expandedFolds = new Set<number>(
        carets ? state.expandedFolds : undefined,
      );
      const foldReveals = new Map<number, FoldReveal>(
        carets ? state.foldReveals : undefined,
      );
      const next = { ...state, ...meta, ...text, expandedFolds, foldReveals };
      // The text may have moved under the kept carets, so a run that was open
      // before can come back collapsed around one. A fresh load places its
      // carets from the same derivation, and they answer to the same rule.
      const derived = carets
        ? deriveVisibleFolds({ ...next, ...carets })
        : deriveVisibleFolds(next, (chunks) =>
            initialCarets(chunks, text, editable, kind === "text"),
          );
      return {
        ...meta,
        ...text,
        ...editing,
        ...derived,
        ...carets,
        ...deriveFind(next),
      };
    }),

  setError: (message) => set({ error: message, loading: false }),

  setCursor: (selection, goalVisual = null) =>
    set((state) => {
      const side = editableSide(state);
      if (!side || state.fallback || state.loading || state.composition) {
        return selection === null ? { cursor: null, goalVisual: null } : {};
      }
      if (!selection) return { cursor: null, goalVisual: null };
      const lines = splitLines(side === "left" ? state.left : state.right);
      const clamped = {
        anchor: clampPosition(lines, selection.anchor),
        head: clampPosition(lines, selection.head),
      };
      const span = ordered(clamped);
      // A caret must never sit on hidden content: expand any fold whose
      // editable-side span intersects the selection.
      const intersecting = state.folds.filter((fold) => {
        const hidden = side === "left" ? fold.left : fold.right;
        return (
          hidden.start <= span.end.line &&
          span.start.line < hidden.start + hidden.count
        );
      });
      let expansion = {};
      if (intersecting.length > 0) {
        const opened = expandFolds(
          state,
          intersecting.map((fold) => fold.key),
        );
        expansion = { ...opened, ...derive({ ...state, ...opened }) };
      }
      return { cursor: clamped, goalVisual, activePane: side, ...expansion };
    }),

  editAt: (selection, text, coalesceKey) =>
    set((state) => {
      const side = editableSide(state);
      if (!side || state.fallback || state.loading || state.composition) {
        return {};
      }
      const applied = applyEditorEdit(state, side, selection, text);
      if (!applied) return {};
      state.history.record(snapshotOf(state, side), coalesceKey, Date.now());
      return {
        ...applied,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  beginComposition: () =>
    set((state) => {
      const side = editableSide(state);
      if (!side || !state.cursor || state.composition) return {};
      // One history step for the whole session — recorded lazily on the
      // first update that changes anything, so a cancelled session leaves
      // no undo step. A selection is consumed as the session opens.
      if (isCaret(state.cursor)) {
        const lines = splitLines(side === "left" ? state.left : state.right);
        const start = clampPosition(lines, state.cursor.head);
        return { composition: { start, endLine: start.line, recorded: false } };
      }
      state.history.record(snapshotOf(state, side), null, Date.now());
      const applied = applyEditorEdit(state, side, state.cursor, "");
      const at = applied?.cursor?.head ?? ordered(state.cursor).start;
      return {
        ...(applied ?? {}),
        composition: { start: at, endLine: at.line, recorded: true },
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  updateComposition: (text) =>
    set((state) => {
      const side = editableSide(state);
      const { composition, cursor } = state;
      if (!side || !composition || !cursor) return {};
      let recorded = composition.recorded;
      if (!recorded && text !== "") {
        state.history.record(snapshotOf(state, side), null, Date.now());
        recorded = true;
      }
      const applied = applyEditorEdit(
        state,
        side,
        { anchor: composition.start, head: cursor.head },
        text,
      );
      const endLine = applied?.cursor?.head.line ?? composition.endLine;
      return {
        ...(applied ?? {}),
        composition: { start: composition.start, endLine, recorded },
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  endComposition: (text) =>
    set((state) => {
      const side = editableSide(state);
      const { composition, cursor } = state;
      if (!side || !composition || !cursor) return {};
      if (!composition.recorded && text !== "") {
        state.history.record(snapshotOf(state, side), null, Date.now());
      }
      const applied = applyEditorEdit(
        state,
        side,
        { anchor: composition.start, head: cursor.head },
        text,
      );
      return {
        ...(applied ?? {}),
        composition: null,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  undo: () =>
    set((state) => {
      const side = editableSide(state);
      if (!side || state.composition) return {};
      const snapshot = state.history.undo(snapshotOf(state, side));
      if (!snapshot) return {};
      return {
        ...restoreSnapshot(state, side, snapshot),
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  redo: () =>
    set((state) => {
      const side = editableSide(state);
      if (!side || state.composition) return {};
      const snapshot = state.history.redo(snapshotOf(state, side));
      if (!snapshot) return {};
      return {
        ...restoreSnapshot(state, side, snapshot),
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  markSaved: (content) =>
    set((state) => {
      const side = editableSide(state);
      if (!side) return {};
      // The baseline is what actually reached the disk, not whatever the
      // buffer holds when the write resolves — edits typed during an
      // in-flight save must stay dirty or the next Cmd+S no-ops on them.
      const text = side === "left" ? state.left : state.right;
      return {
        savedText: content,
        dirty: text !== content,
        diskChanged: false,
      };
    }),

  setDiskChanged: (diskChanged) => set({ diskChanged }),

  setWhitespace: (whitespace) =>
    // Per-side match lists are ordered within their own document, so a
    // re-chunk moves nothing in them — no find recompute needed here. The
    // active chunk is an index into the freshly computed list, though, and
    // keeping it would announce a difference the user never stepped to.
    set((state) => ({
      whitespace,
      activeChunk: -1,
      ...deriveVisibleFolds({ ...state, whitespace }),
    })),

  setGranularity: (granularity) => set({ granularity }),

  toggleSyncScroll: () => set((state) => ({ syncScroll: !state.syncScroll })),

  toggleCollapseUnchanged: () =>
    set((state) => {
      const collapseUnchanged = !state.collapseUnchanged;
      // Turning collapsing back on re-collapses everything: the toggle reads
      // as "collapse unchanged", not "restore my expansion history". The runs
      // holding a caret stay open, since no caret may sit on hidden content.
      const forgotten = {
        expandedFolds: new Set<number>(),
        foldReveals: new Map<number, FoldReveal>(),
      };
      return {
        collapseUnchanged,
        ...deriveVisibleFolds({ ...state, collapseUnchanged, ...forgotten }),
      };
    }),

  setCollapsed: (collapsed) =>
    set((state) => {
      // Collapsing forgets expansion history either way, partial reveals
      // included: "collapse" means everything, and expanded-all needs no
      // per-fold bookkeeping. The runs holding a caret are the one
      // exception, as above.
      const forgotten = {
        expandedFolds: new Set<number>(),
        foldReveals: new Map<number, FoldReveal>(),
      };
      return {
        collapseUnchanged: collapsed,
        ...deriveVisibleFolds({
          ...state,
          collapseUnchanged: collapsed,
          ...forgotten,
        }),
      };
    }),

  setContextLines: (contextLines) =>
    set((state) => {
      // The runs' edges move with the context, so what was revealed of a
      // run no longer names the same lines; the reveals start over.
      const foldReveals = new Map<number, FoldReveal>();
      return {
        contextLines,
        ...deriveVisibleFolds({ ...state, contextLines, foldReveals }),
      };
    }),

  setViewMode: (viewMode) => set({ viewMode }),

  toggleFold: (key) =>
    set((state) => {
      // Either way the fold's partial reveal is spent: expanding it opens
      // the whole run, and re-collapsing it brings the whole run back.
      const foldReveals = new Map(state.foldReveals);
      foldReveals.delete(key);
      const expandedFolds = new Set(state.expandedFolds);
      if (expandedFolds.has(key)) expandedFolds.delete(key);
      else expandedFolds.add(key);
      // No scroll compensation: a fold can only be toggled while its row is
      // visible, and the axis only lengthens below the viewport top.
      const opened = { expandedFolds, foldReveals };
      return { ...opened, ...derive({ ...state, ...opened }) };
    }),

  revealFold: (key) => {
    const state = get();
    const pane = referencePane(state);
    const fold = state.folds.find((candidate) => candidate.key === key);
    if (!fold) return { pane, caretRow: null, rows: 0 };
    const step = foldStep(fold, foldRevealEnd(state, fold));
    // The last step opens the run whole, which is what expansion already
    // means; anything short of it is remembered per end, so a caret that
    // moves between clicks does not reset the other end's progress.
    let opened: Pick<DiffStoreState, "expandedFolds" | "foldReveals">;
    if (step.rest) {
      opened = expandFolds(state, [key]);
    } else {
      const foldReveals = new Map(state.foldReveals);
      foldReveals.set(key, {
        ...fold.revealed,
        [step.end]: fold.revealed[step.end] + step.lines,
      });
      opened = { expandedFolds: state.expandedFolds, foldReveals };
    }
    const patch = { ...opened, ...derive({ ...state, ...opened }) };
    set(patch);
    // Rows revealed above the caret push its line down its pane; the
    // difference in the caret's own row is exactly that push.
    const caretRow = caretDisplayRow(state, pane);
    const after = caretDisplayRow({ ...state, ...patch }, pane);
    return {
      pane,
      caretRow,
      rows: caretRow === null || after === null ? 0 : after - caretRow,
    };
  },

  // Swapping re-runs the diff rather than mirroring the existing chunks:
  // a diff is not symmetric, so reversing the inputs is the only way to get
  // the additions and deletions the other way round rather than merely
  // relabelled.
  swapSides: () =>
    set((state) => {
      // A live composition's text is already in the buffer (updates apply
      // live); the session bookkeeping and the cursor speak in the old
      // side's coordinates, so both reset with the swap.
      const committed = state;
      const swapped = {
        left: committed.right,
        right: committed.left,
        leftRef: committed.rightRef,
        rightRef: committed.leftRef,
        leftLabel: committed.rightLabel,
        rightLabel: committed.leftLabel,
      };
      // Expansion and reveals are keyed on left start lines, and the swap
      // moves every fold to the other side's numbering — so everything
      // re-collapses.
      const forgotten = {
        expandedFolds: new Set<number>(),
        foldReveals: new Map<number, FoldReveal>(),
      };
      // Every caret spoke in the old side's coordinates; they start over on
      // the first change, as they did when the diff opened, and a run that
      // would hide one of them opens.
      const derived = deriveVisibleFolds(
        { ...committed, ...swapped, ...forgotten },
        (chunks) =>
          initialCarets(
            chunks,
            swapped,
            editableSide(swapped),
            committed.fallback === null,
          ),
      );
      return {
        ...swapped,
        goalVisual: null,
        composition: null,
        dirty: committed.dirty,
        // The placeholder's per-side facts swap with the labels above them;
        // a swapped image diff that kept its images in place would lie.
        fallback: swapFallback(committed.fallback),
        swapped: !committed.swapped,
        activeChunk: -1,
        ...derived,
        // The bars are positional — each keeps its query and re-searches the
        // text that now sits under it.
        ...deriveFind({ ...committed, ...swapped }),
      };
    }),

  stepDifference: (delta) =>
    set((state) => {
      const indices = state.chunks
        .map((chunk, index) => ({ chunk, index }))
        .filter(({ chunk }) => chunk.kind !== "equal")
        .map(({ index }) => index);
      if (indices.length === 0) return {};

      const current = indices.indexOf(state.activeChunk);
      // Stepping forward from nothing lands on the first difference, and
      // backward from nothing on the last, so both directions are usable
      // before anything has been selected.
      const next =
        current === -1
          ? delta > 0
            ? 0
            : indices.length - 1
          : (current + delta + indices.length) % indices.length;
      return { activeChunk: indices[next] };
    }),

  // The two "axis" getters answer in the current view's scroll units — a
  // split-axis position, or a unified row index. Their callers (the toolbar
  // stepper, the find bar) just scroll to what they are told and never learn
  // which view is up.
  activeChunkAxis: () => {
    const state = get();
    return chunkAxis(state, state.activeChunk);
  },

  openFind: () =>
    // Reopening with queries still typed brings their matches straight back.
    set((state) => {
      const opened = { ...state, findOpen: true };
      return { findOpen: true, ...deriveFind(opened) };
    }),

  closeFind: () =>
    // The queries survive the close — reopening restores them, the way every
    // editor's find behaves — but the highlights go with the bars.
    set((state) => ({
      findOpen: false,
      findLeft: { ...state.findLeft, matches: [], activeMatch: -1 },
      findRight: { ...state.findRight, matches: [], activeMatch: -1 },
      activeFindSide: null,
    })),

  setFindQuery: (side, query) =>
    set((state) => updateSideFind(state, side, { query })),

  toggleFindCase: (side) =>
    set((state) => {
      const current = side === "left" ? state.findLeft : state.findRight;
      return updateSideFind(state, side, {
        caseSensitive: !current.caseSensitive,
      });
    }),

  toggleFindWord: (side) =>
    set((state) => {
      const current = side === "left" ? state.findLeft : state.findRight;
      return updateSideFind(state, side, { wholeWord: !current.wholeWord });
    }),

  toggleFindRegex: (side) =>
    set((state) => {
      const current = side === "left" ? state.findLeft : state.findRight;
      return updateSideFind(state, side, { regex: !current.regex });
    }),

  stepMatch: (side, delta) =>
    set((state) => {
      const current = side === "left" ? state.findLeft : state.findRight;
      if (current.matches.length === 0) return {};
      const next = {
        ...current,
        activeMatch:
          (current.activeMatch + delta + current.matches.length) %
          current.matches.length,
        // Bumped even when the index wraps back onto itself, so Enter on a
        // 1/1 result still re-reveals the match after scrolling away.
        revealSeq: current.revealSeq + 1,
      };
      return side === "left"
        ? { findLeft: next, activeFindSide: side }
        : { findRight: next, activeFindSide: side };
    }),

  revealActiveMatch: (side) => {
    const state = get();
    const current = side === "left" ? state.findLeft : state.findRight;
    const match = current.matches[current.activeMatch];
    if (!match) return;
    const hiddenIn = state.folds.find((fold) => {
      const span = match.side === "left" ? fold.left : fold.right;
      return match.line >= span.start && match.line < span.start + span.count;
    });
    if (hiddenIn) state.toggleFold(hiddenIn.key);
  },

  activeMatchAxis: (side) => {
    const { chunks, folds, viewMode, findLeft, findRight } = get();
    const current = side === "left" ? findLeft : findRight;
    const match = current.matches[current.activeMatch];
    if (!match) return null;
    if (viewMode === "unified") {
      const row = unifiedRowOf(
        unifiedRows(chunks, folds),
        match.side,
        match.line,
      );
      return row >= 0 ? row : null;
    }
    return sideToAxis(chunks, match.line, match.side, folds);
  },
}));

/** What one history step remembers: the editable side's text and cursor. */
interface DiffEditSnapshot {
  text: string;
  cursor: EditorSelection | null;
}

function snapshotOf(state: DiffStoreState, side: Side): DiffEditSnapshot {
  return {
    text: side === "left" ? state.left : state.right,
    cursor: state.cursor,
  };
}

function restoreSnapshot(
  state: DiffStoreState,
  side: Side,
  snapshot: DiffEditSnapshot,
): Partial<DiffStoreState> {
  const texts =
    side === "left"
      ? { left: snapshot.text, right: state.right }
      : { left: state.left, right: snapshot.text };
  const next = { ...state, ...texts, cursor: snapshot.cursor };
  return {
    ...texts,
    goalVisual: null,
    dirty: snapshot.text !== state.savedText,
    activeChunk: -1,
    ...deriveVisibleFolds(next),
    ...deriveFind(next),
    cursor: snapshot.cursor,
  };
}

/**
 * Apply one editor edit to the editable side and carry every dependent
 * structure with it — texts, fold-expansion keys, the find walk, the derived
 * world, cursor and dirty. Returns null for a true no-op (a collapsed
 * selection inserting nothing), which callers must not record in history.
 */
function applyEditorEdit(
  state: DiffStoreState,
  side: Side,
  selection: EditorSelection,
  text: string,
): (Partial<DiffStoreState> & { cursor: EditorSelection }) | null {
  if (text === "" && isCaret(selection)) return null;
  const sideText = side === "left" ? state.left : state.right;
  const lines = splitLines(sideText);
  const edit = applyTextEdit(lines, selection, text);
  const trailing = sideText === "" ? true : sideText.endsWith("\n");
  const replaced =
    edit.lines.length === 0
      ? ""
      : edit.lines.join("\n") + (trailing ? "\n" : "");
  if (replaced === sideText) return null;
  const texts =
    side === "left"
      ? { left: replaced, right: state.right }
      : { left: state.left, right: replaced };
  const splice: LineSplice = {
    start: edit.replaced.start.line,
    end: edit.replaced.end.line + 1,
    delta: edit.lineDelta,
  };
  // Expansion and reveal keys are left start lines; a left-side splice
  // shifts every fold below it, and the keys must follow or the folds the
  // user opened snap shut under the cursor.
  const expandedFolds =
    side === "left"
      ? remapLineKeys(state.expandedFolds, splice)
      : state.expandedFolds;
  const foldReveals =
    side === "left"
      ? remapLineKeyMap(state.foldReveals, splice)
      : state.foldReveals;
  const cursor = caretAt(edit.caret.line, edit.caret.col);
  const next = { ...state, ...texts, expandedFolds, foldReveals, cursor };
  return {
    ...texts,
    goalVisual: null,
    dirty: replaced !== state.savedText,
    // The chunk list was just rebuilt; a held index would name a stranger.
    activeChunk: -1,
    // Re-chunking can fold a run over a caret that never moved, the edit's
    // own cursor included, so the derivation answers to the same rule as
    // every other one.
    ...deriveVisibleFolds(next),
    ...deriveFind(next, { ...splice, side }),
    cursor,
  };
}

/**
 * One bar changed its query or an option: re-search that side only, and hand
 * it the active box — acting in a bar is what makes it the current one.
 */
function updateSideFind(
  state: DiffStoreState,
  side: Side,
  change: Partial<
    Pick<SideFindState, "query" | "caseSensitive" | "wholeWord" | "regex">
  >,
): Partial<DiffStoreState> {
  const current = side === "left" ? state.findLeft : state.findRight;
  const text = side === "left" ? state.left : state.right;
  const next = recomputeSide(
    text,
    side,
    // A changed query or option starts a fresh walk from the first match.
    { ...current, ...change, matches: [], activeMatch: -1 },
    state.findOpen,
  );
  const bumped = { ...next, revealSeq: current.revealSeq + 1 };
  return side === "left"
    ? { findLeft: bumped, activeFindSide: side }
    : { findRight: bumped, activeFindSide: side };
}
