import { create } from "zustand";
import {
  axisLength,
  type ChunkOptions,
  computeChunks,
  computeFolds,
  countDifferences,
  type DiffChunk,
  type FoldRegion,
  sideToAxis,
  splitLines,
} from "../../diff/utils/diff-model";
import {
  computeMatches,
  type FindMatch,
  type FindScope,
} from "../../diff/utils/find";
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
   */
  findOpen: boolean;
  findQuery: string;
  findCase: boolean;
  findWord: boolean;
  findRegex: boolean;
  findScope: FindScope;
  /** Every hit, in reading (axis) order. */
  matches: FindMatch[];
  /** Index into `matches`, or -1 when there is none. */
  activeMatch: number;

  setSides: (sides: DiffSidesResult) => void;
  setError: (message: string | null) => void;
  setWhitespace: (value: Whitespace) => void;
  setGranularity: (value: Granularity) => void;
  toggleSyncScroll: () => void;
  toggleCollapseUnchanged: () => void;
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
  setFindQuery: (query: string) => void;
  toggleFindCase: () => void;
  toggleFindWord: () => void;
  toggleFindRegex: () => void;
  cycleFindScope: () => void;
  /** Move to the next (+1) or previous (-1) match, wrapping. */
  stepMatch: (delta: number) => void;
  /**
   * Expand the fold hiding the active match, if one does. Jumping to a match
   * the viewer then cannot show would make the count read as a lie.
   */
  revealActiveMatch: () => void;
  /** Axis position that reveals the active match, or null when there is none. */
  activeMatchAxis: () => number | null;
}

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
 * Recompute the match list from the texts and the current find options.
 *
 * Runs on every keystroke without debouncing: the tooLarge gate caps text
 * diffs at 25k lines, and a substring scan over that is single-digit
 * milliseconds. The first match becomes active so typing jumps to it, which
 * is what every editor's find does.
 */
function deriveFind(state: {
  left: string;
  right: string;
  chunks: DiffChunk[];
  findOpen: boolean;
  findQuery: string;
  findCase: boolean;
  findWord: boolean;
  findRegex: boolean;
  findScope: FindScope;
}) {
  const matches =
    state.findOpen && state.findQuery !== ""
      ? computeMatches(
          splitLines(state.left),
          splitLines(state.right),
          state.chunks,
          state.findQuery,
          {
            caseSensitive: state.findCase,
            wholeWord: state.findWord,
            regex: state.findRegex,
            scope: state.findScope,
          },
        )
      : [];
  return { matches, activeMatch: matches.length > 0 ? 0 : -1 };
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
  findQuery: "",
  findCase: false,
  findWord: false,
  findRegex: false,
  findScope: "both",
  matches: [],
  activeMatch: -1,

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
      const derived = derive(next);
      return {
        ...meta,
        ...text,
        ...derived,
        ...deriveFind({ ...next, ...derived }),
      };
    }),

  setError: (message) => set({ error: message, loading: false }),

  setWhitespace: (whitespace) =>
    set((state) => {
      const derived = derive({ ...state, whitespace });
      return {
        whitespace,
        ...derived,
        // Chunks moved, so the matches' reading order may have too.
        ...deriveFind({ ...state, ...derived }),
      };
    }),

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
      const derived = derive({ ...state, ...swapped, expandedFolds });
      return {
        ...swapped,
        // The placeholder's per-side facts swap with the labels above them;
        // a swapped image diff that kept its images in place would lie.
        fallback: swapFallback(state.fallback),
        swapped: !state.swapped,
        activeChunk: -1,
        expandedFolds,
        ...derived,
        ...deriveFind({ ...state, ...swapped, ...derived }),
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
    // Reopening with a query still typed brings its matches straight back.
    set((state) => {
      const opened = { ...state, findOpen: true };
      return { findOpen: true, ...deriveFind(opened) };
    }),

  closeFind: () =>
    // The query survives the close — reopening restores it, the way every
    // editor's find behaves — but the highlights go with the bar.
    set({ findOpen: false, matches: [], activeMatch: -1 }),

  setFindQuery: (findQuery) =>
    set((state) => ({ findQuery, ...deriveFind({ ...state, findQuery }) })),

  toggleFindCase: () =>
    set((state) => {
      const findCase = !state.findCase;
      return { findCase, ...deriveFind({ ...state, findCase }) };
    }),

  toggleFindWord: () =>
    set((state) => {
      const findWord = !state.findWord;
      return { findWord, ...deriveFind({ ...state, findWord }) };
    }),

  toggleFindRegex: () =>
    set((state) => {
      const findRegex = !state.findRegex;
      return { findRegex, ...deriveFind({ ...state, findRegex }) };
    }),

  cycleFindScope: () =>
    set((state) => {
      const order: FindScope[] = ["both", "left", "right"];
      const findScope =
        order[(order.indexOf(state.findScope) + 1) % order.length];
      return { findScope, ...deriveFind({ ...state, findScope }) };
    }),

  stepMatch: (delta) =>
    set((state) => {
      if (state.matches.length === 0) return {};
      const next =
        (state.activeMatch + delta + state.matches.length) %
        state.matches.length;
      return { activeMatch: next };
    }),

  revealActiveMatch: () => {
    const { folds, matches, activeMatch, toggleFold } = get();
    const match = matches[activeMatch];
    if (!match) return;
    const hiddenIn = folds.find((fold) => {
      const span = match.side === "left" ? fold.left : fold.right;
      return match.line >= span.start && match.line < span.start + span.count;
    });
    if (hiddenIn) toggleFold(hiddenIn.left.start);
  },

  activeMatchAxis: () => {
    const { chunks, folds, matches, activeMatch, viewMode } = get();
    const match = matches[activeMatch];
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
