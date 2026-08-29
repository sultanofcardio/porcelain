import { create } from "zustand";
import {
  axisLength,
  type ChunkOptions,
  computeChunks,
  computeFolds,
  countDifferences,
  type DiffChunk,
  type FoldRegion,
  type Side,
  sideToAxis,
  splitLines,
} from "../../diff/utils/diff-model";
import { type FindMatch, sideMatches } from "../../diff/utils/find";
import {
  unifiedChunkRow,
  unifiedRowOf,
  unifiedRows,
} from "../../diff/utils/unified";
import type { DiffSidesResult } from "../bridge/types";

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

export type Whitespace = "none" | "trim";

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
  /** Left start lines of folds the user has expanded. */
  expandedFolds: ReadonlySet<number>;
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
  /** Expand or re-collapse one fold, identified by its left start line. */
  toggleFold: (leftStart: number) => void;
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
}

const EMPTY_SIDE_FIND: SideFindState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  matches: [],
  activeMatch: -1,
};

function chunkOptionsFor(whitespace: Whitespace): ChunkOptions {
  return { ignoreWhitespace: whitespace === "trim" };
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
}) {
  const chunks = computeChunks(
    state.left,
    state.right,
    chunkOptionsFor(state.whitespace),
  );
  // `folds` holds only the folds currently collapsed. Expansion is keyed on
  // the hidden run's starting left line, not on chunkIndex: toggling
  // whitespace re-chunks the file and shifts every index, and an expanded
  // fold that silently became a different expanded fold would be a bug the
  // user could not even describe.
  const folds = state.collapseUnchanged
    ? computeFolds(chunks, { contextLines: state.contextLines }).filter(
        (fold) => !state.expandedFolds.has(fold.left.start),
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
): SideFindState {
  const matches =
    open && sideState.query !== ""
      ? sideMatches(splitLines(text), side, sideState.query, {
          caseSensitive: sideState.caseSensitive,
          wholeWord: sideState.wholeWord,
          regex: sideState.regex,
        })
      : [];
  return { ...sideState, matches, activeMatch: matches.length > 0 ? 0 : -1 };
}

/** Both bars, refreshed against the current texts. */
function deriveFind(state: {
  left: string;
  right: string;
  findOpen: boolean;
  findLeft: SideFindState;
  findRight: SideFindState;
}) {
  return {
    findLeft: recomputeSide(state.left, "left", state.findLeft, state.findOpen),
    findRight: recomputeSide(
      state.right,
      "right",
      state.findRight,
      state.findOpen,
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
        activeChunk: -1,
        // New content, new folds: what was expanded in the old diff has no
        // meaning in this one.
        expandedFolds: new Set<number>(),
      };
      const text =
        kind === "text"
          ? { left: sides.left, right: sides.right, fallback: null }
          : // Nothing to chunk: the placeholder carries the host's verdict,
            // and the derived state empties so the toolbar and stripe go
            // quiet.
            { left: "", right: "", fallback: sides };
      const next = { ...state, ...meta, ...text };
      return {
        ...meta,
        ...text,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  setError: (message) => set({ error: message, loading: false }),

  setWhitespace: (whitespace) =>
    // Per-side match lists are ordered within their own document, so a
    // re-chunk moves nothing in them — no find recompute needed here.
    set((state) => ({ whitespace, ...derive({ ...state, whitespace }) })),

  setGranularity: (granularity) => set({ granularity }),

  toggleSyncScroll: () => set((state) => ({ syncScroll: !state.syncScroll })),

  toggleCollapseUnchanged: () =>
    set((state) => {
      const collapseUnchanged = !state.collapseUnchanged;
      // Turning collapsing back on re-collapses everything: the toggle reads
      // as "collapse unchanged", not "restore my expansion history".
      const expandedFolds = new Set<number>();
      return {
        collapseUnchanged,
        expandedFolds,
        ...derive({ ...state, collapseUnchanged, expandedFolds }),
      };
    }),

  setCollapsed: (collapsed) =>
    set((state) => {
      // Collapsing forgets expansion history either way: "collapse" means
      // everything, and expanded-all needs no per-fold bookkeeping.
      const expandedFolds = new Set<number>();
      return {
        collapseUnchanged: collapsed,
        expandedFolds,
        ...derive({ ...state, collapseUnchanged: collapsed, expandedFolds }),
      };
    }),

  setContextLines: (contextLines) =>
    set((state) => ({ contextLines, ...derive({ ...state, contextLines }) })),

  setViewMode: (viewMode) => set({ viewMode }),

  toggleFold: (leftStart) =>
    set((state) => {
      const expandedFolds = new Set(state.expandedFolds);
      if (expandedFolds.has(leftStart)) expandedFolds.delete(leftStart);
      else expandedFolds.add(leftStart);
      // No scroll compensation: a fold can only be toggled while its row is
      // visible, and the axis only lengthens below the viewport top.
      return { expandedFolds, ...derive({ ...state, expandedFolds }) };
    }),

  // Swapping re-runs the diff rather than mirroring the existing chunks:
  // a diff is not symmetric, so reversing the inputs is the only way to get
  // the additions and deletions the other way round rather than merely
  // relabelled.
  swapSides: () =>
    set((state) => {
      const swapped = {
        left: state.right,
        right: state.left,
        leftRef: state.rightRef,
        rightRef: state.leftRef,
        leftLabel: state.rightLabel,
        rightLabel: state.leftLabel,
      };
      // Expansion is keyed on left start lines, and the swap moves every
      // fold to the other side's numbering — so everything re-collapses.
      const expandedFolds = new Set<number>();
      return {
        ...swapped,
        // The placeholder's per-side facts swap with the labels above them;
        // a swapped image diff that kept its images in place would lie.
        fallback: swapFallback(state.fallback),
        swapped: !state.swapped,
        activeChunk: -1,
        expandedFolds,
        ...derive({ ...state, ...swapped, expandedFolds }),
        // The bars are positional — each keeps its query and re-searches the
        // text that now sits under it.
        ...deriveFind({ ...state, ...swapped }),
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
    const { chunks, folds, activeChunk, viewMode } = get();
    const chunk = chunks[activeChunk];
    if (!chunk) return null;
    if (viewMode === "unified") {
      const row = unifiedChunkRow(unifiedRows(chunks, folds), activeChunk);
      return row >= 0 ? row : null;
    }
    const side = chunk.right.count > 0 ? "right" : "left";
    const span = side === "right" ? chunk.right : chunk.left;
    return sideToAxis(chunks, span.start, side, folds);
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
    if (hiddenIn) state.toggleFold(hiddenIn.left.start);
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
    { ...current, ...change },
    state.findOpen,
  );
  return side === "left"
    ? { findLeft: next, activeFindSide: side }
    : { findRight: next, activeFindSide: side };
}
