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
} from "../../diff/utils/diff-model";

/** How much of a changed line is highlighted within the line. */
export type Granularity = "line" | "word" | "character" | "none";

export type Whitespace = "none" | "trim";

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

  chunks: DiffChunk[];
  folds: FoldRegion[];
  differences: number;
  /** Length of the shared scroll axis, in line-heights. */
  axis: number;

  whitespace: Whitespace;
  granularity: Granularity;
  syncScroll: boolean;
  collapseUnchanged: boolean;
  contextLines: number;
  swapped: boolean;
  /** Index into `chunks` of the difference the toolbar last stepped to. */
  activeChunk: number;

  setSides: (sides: {
    left: string;
    right: string;
    filePath: string;
    leftRef: string;
    rightRef: string;
    leftLabel: string;
    rightLabel: string;
    language: string;
  }) => void;
  setError: (message: string | null) => void;
  setWhitespace: (value: Whitespace) => void;
  setGranularity: (value: Granularity) => void;
  toggleSyncScroll: () => void;
  toggleCollapseUnchanged: () => void;
  setContextLines: (value: number) => void;
  swapSides: () => void;
  stepDifference: (delta: number) => void;
  /** Axis position that reveals the active difference, or null when there is none. */
  activeChunkAxis: () => number | null;
}

function chunkOptionsFor(whitespace: Whitespace): ChunkOptions {
  return { ignoreWhitespace: whitespace === "trim" };
}

/** Recompute everything derived from the two texts and the current options. */
function derive(state: {
  left: string;
  right: string;
  whitespace: Whitespace;
  collapseUnchanged: boolean;
  contextLines: number;
}) {
  const chunks = computeChunks(
    state.left,
    state.right,
    chunkOptionsFor(state.whitespace),
  );
  return {
    chunks,
    differences: countDifferences(chunks),
    axis: axisLength(chunks),
    folds: state.collapseUnchanged
      ? computeFolds(chunks, { contextLines: state.contextLines })
      : [],
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

  chunks: [],
  folds: [],
  differences: 0,
  axis: 0,

  whitespace: "none",
  granularity: "word",
  syncScroll: true,
  collapseUnchanged: true,
  contextLines: 3,
  swapped: false,
  activeChunk: -1,

  setSides: (sides) =>
    set((state) => ({
      ...sides,
      loading: false,
      error: null,
      activeChunk: -1,
      ...derive({ ...state, left: sides.left, right: sides.right }),
    })),

  setError: (message) => set({ error: message, loading: false }),

  setWhitespace: (whitespace) =>
    set((state) => ({ whitespace, ...derive({ ...state, whitespace }) })),

  setGranularity: (granularity) => set({ granularity }),

  toggleSyncScroll: () => set((state) => ({ syncScroll: !state.syncScroll })),

  toggleCollapseUnchanged: () =>
    set((state) => {
      const collapseUnchanged = !state.collapseUnchanged;
      return { collapseUnchanged, ...derive({ ...state, collapseUnchanged }) };
    }),

  setContextLines: (contextLines) =>
    set((state) => ({ contextLines, ...derive({ ...state, contextLines }) })),

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
      return {
        ...swapped,
        swapped: !state.swapped,
        activeChunk: -1,
        ...derive({ ...state, ...swapped }),
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

  activeChunkAxis: () => {
    const { chunks, activeChunk } = get();
    const chunk = chunks[activeChunk];
    if (!chunk) return null;
    const side = chunk.right.count > 0 ? "right" : "left";
    const span = side === "right" ? chunk.right : chunk.left;
    return sideToAxis(chunks, span.start, side);
  },
}));
