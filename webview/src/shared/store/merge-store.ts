import { create } from "zustand";
import {
  computeChunks,
  type DiffChunk,
  displayLine,
} from "../../diff/utils/diff-model";
import { type FindMatch, sideMatches } from "../../diff/utils/find";
import {
  applyIslandEdit,
  applyRegionDecision,
  buildInitialResult,
  buildMergeAxis,
  type ConflictRegion,
  computeMergeFolds,
  flankRegionKinds,
  islandRangeAt,
  joinDoc,
  type MergeAxisMap,
  type MergeFolds,
  type MergeLineKind,
  type MergePane,
  paneToAxis,
  regionResolved,
  resultRegionKinds,
  splitDoc,
  type TextDoc,
} from "../../merge/utils/merge-model";
import type { FileVersionsResult } from "../bridge/types";
import type { SideFindState } from "./diff-store";

/**
 * The rebuilt merge editor's store: one result buffer, a region list over it,
 * and two live 2-way diffs against the flanks — everything else (folds, the
 * axis, the paints, the counts) is derived and rebuilt wholesale by
 * `derive()`, the same shape the diff store uses. The legacy block model and
 * its four accept/skip booleans per block are gone; accepts and keystrokes
 * are both splices now, so one undo stack covers both.
 */

export type MergeFallbackInfo =
  | { kind: "binary"; bytes: number }
  | { kind: "tooLarge"; lines: number; limit: number }
  | { kind: "unreadable"; reason: string };

interface MergeSnapshot {
  result: TextDoc;
  regions: ConflictRegion[];
}

export interface MergeStoreState {
  /** Flank documents — immutable after load; the buffer is the result's. */
  ours: TextDoc;
  theirs: TextDoc;
  result: TextDoc;
  regions: ConflictRegion[];

  filePath: string;
  language: string;
  mergeMsg: string;
  oursLabel: string;
  theirsLabel: string;
  loading: boolean;
  error: string | null;
  fallback: MergeFallbackInfo | null;

  chunksOurs: DiffChunk[];
  chunksTheirs: DiffChunk[];
  folds: MergeFolds;
  axis: MergeAxisMap;
  resultKinds: Map<number, MergeLineKind>;
  oursKinds: Map<number, MergeLineKind>;
  theirsKinds: Map<number, MergeLineKind>;
  conflictTotal: number;
  conflictResolved: number;
  allResolved: boolean;
  /** Any splice happened since load — gates the cancel confirmation. */
  dirty: boolean;

  collapseUnchanged: boolean;
  contextLines: number;
  /** Result start lines of folds the user has expanded. */
  expandedFolds: ReadonlySet<number>;
  /** Index into `regions` of the conflict the stepper is on. */
  activeRegion: number;

  /** The island open on the result pane, when one is. */
  island: { start: number; lines: string[] } | null;
  undoStack: MergeSnapshot[];

  findOpen: boolean;
  findPanes: Record<MergePane, SideFindState>;
  activeFindPane: MergePane | null;

  load: (versions: FileVersionsResult) => void;
  setError: (message: string | null) => void;
  decideRegion: (
    index: number,
    change:
      | { action: "accept"; side: "ours" | "theirs" }
      | { action: "ignore"; side: "ours" | "theirs" }
      | { action: "revert" },
  ) => void;
  stepConflict: (delta: number) => void;
  /** Axis position revealing the active conflict, or null when none. */
  activeRegionAxis: () => number | null;

  openIsland: (line: number) => void;
  /** Open on a region's range directly — the gutter's edit affordance. */
  openIslandForRegion: (index: number) => void;
  islandLinesChanged: (lines: string[]) => void;
  commitIsland: (lines: string[]) => void;
  undo: () => void;

  toggleFold: (resultStart: number) => void;
  setCollapsed: (collapsed: boolean) => void;
  setContextLines: (value: number) => void;

  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (pane: MergePane, query: string) => void;
  toggleFindCase: (pane: MergePane) => void;
  toggleFindWord: (pane: MergePane) => void;
  toggleFindRegex: (pane: MergePane) => void;
  stepMatch: (pane: MergePane, delta: number) => void;
  /** Expand the fold hiding a pane's active match, if one does. */
  revealActiveMatch: (pane: MergePane) => void;
  /** Axis position of a pane's active match, or null. */
  activeMatchAxis: (pane: MergePane) => number | null;

  /** What Apply writes: the buffer with its EOF newline preserved. */
  mergedText: () => string;
}

const EMPTY_FIND: SideFindState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  matches: [],
  activeMatch: -1,
};

const EMPTY_DOC: TextDoc = { lines: [], trailingNewline: false };

/**
 * Which `Side` a pane renders as in its pair — what `DiffPane` and
 * `sideMatches` are told. Ours is pair O's left; result and theirs are their
 * pairs' right.
 */
export const PANE_SIDE = {
  ours: "left",
  result: "right",
  theirs: "right",
} as const;

/** The pair-specific folds a pane's display coordinate lives in. */
export function paneFolds(folds: MergeFolds, pane: MergePane) {
  return pane === "theirs" ? folds.pairT : folds.pairO;
}

function paneLines(state: MergeStoreState, pane: MergePane): string[] {
  if (pane === "ours") return state.ours.lines;
  if (pane === "theirs") return state.theirs.lines;
  return state.result.lines;
}

/** Everything derived from (flanks, result, regions, fold options). */
function derive(state: {
  ours: TextDoc;
  theirs: TextDoc;
  result: TextDoc;
  regions: ConflictRegion[];
  collapseUnchanged: boolean;
  contextLines: number;
  expandedFolds: ReadonlySet<number>;
}) {
  const oursText = state.ours.lines.join("\n");
  const theirsText = state.theirs.lines.join("\n");
  const resultText = state.result.lines.join("\n");

  const chunksOurs = computeChunks(oursText, resultText);
  const chunksTheirs = computeChunks(resultText, theirsText);

  let folds: MergeFolds = { pairO: [], pairT: [] };
  if (state.collapseUnchanged) {
    const computed = computeMergeFolds(
      chunksOurs,
      chunksTheirs,
      state.result.lines.length,
      { contextLines: state.contextLines },
    );
    // The pair lists are parallel; expansion is keyed on the hidden run's
    // result start line, which both pairs agree on by construction.
    const keep = computed.pairO.map(
      (fold) => !state.expandedFolds.has(fold.right.start),
    );
    folds = {
      pairO: computed.pairO.filter((_, i) => keep[i]),
      pairT: computed.pairT.filter((_, i) => keep[i]),
    };
  }

  const axis = buildMergeAxis(
    state.result.lines.length,
    chunksOurs,
    chunksTheirs,
    folds,
  );

  const conflictTotal = state.regions.length;
  const conflictResolved = state.regions.filter(regionResolved).length;

  return {
    chunksOurs,
    chunksTheirs,
    folds,
    axis,
    resultKinds: resultRegionKinds(state.regions),
    oursKinds: flankRegionKinds(state.regions, "ours"),
    theirsKinds: flankRegionKinds(state.regions, "theirs"),
    conflictTotal,
    conflictResolved,
    allResolved: conflictResolved === conflictTotal,
  };
}

/** One pane's match list, refreshed against its text. */
function recomputePane(
  lines: readonly string[],
  pane: MergePane,
  paneState: SideFindState,
  open: boolean,
): SideFindState {
  const matches =
    open && paneState.query !== ""
      ? sideMatches(lines, PANE_SIDE[pane], paneState.query, {
          caseSensitive: paneState.caseSensitive,
          wholeWord: paneState.wholeWord,
          regex: paneState.regex,
        })
      : [];
  return { ...paneState, matches, activeMatch: matches.length > 0 ? 0 : -1 };
}

function deriveFind(state: MergeStoreState): {
  findPanes: Record<MergePane, SideFindState>;
} {
  return {
    findPanes: {
      ours: recomputePane(
        state.ours.lines,
        "ours",
        state.findPanes.ours,
        state.findOpen,
      ),
      result: recomputePane(
        state.result.lines,
        "result",
        state.findPanes.result,
        state.findOpen,
      ),
      theirs: recomputePane(
        state.theirs.lines,
        "theirs",
        state.findPanes.theirs,
        state.findOpen,
      ),
    },
  };
}

const UNDO_LIMIT = 100;

function pushUndo(state: MergeStoreState): MergeSnapshot[] {
  return [
    ...state.undoStack.slice(-(UNDO_LIMIT - 1)),
    { result: state.result, regions: state.regions },
  ];
}

export const useMergeStore = create<MergeStoreState>((set, get) => ({
  ours: EMPTY_DOC,
  theirs: EMPTY_DOC,
  result: EMPTY_DOC,
  regions: [],

  filePath: "",
  language: "plaintext",
  mergeMsg: "",
  oursLabel: "yours",
  theirsLabel: "theirs",
  loading: true,
  error: null,
  fallback: null,

  chunksOurs: [],
  chunksTheirs: [],
  folds: { pairO: [], pairT: [] },
  axis: {
    segments: [],
    length: 0,
    resultRows: 0,
    oursRows: 0,
    theirsRows: 0,
  },
  resultKinds: new Map(),
  oursKinds: new Map(),
  theirsKinds: new Map(),
  conflictTotal: 0,
  conflictResolved: 0,
  allResolved: true,
  dirty: false,

  collapseUnchanged: true,
  contextLines: 3,
  expandedFolds: new Set<number>(),
  activeRegion: -1,

  island: null,
  undoStack: [],

  findOpen: false,
  findPanes: { ours: EMPTY_FIND, result: EMPTY_FIND, theirs: EMPTY_FIND },
  activeFindPane: null,

  load: (versions) =>
    set((state) => {
      const meta = {
        filePath: versions.filePath,
        language: versions.language,
        mergeMsg: versions.mergeMsg,
        oursLabel: versions.oursLabel,
        theirsLabel: versions.theirsLabel,
        loading: false,
        error: null,
        activeRegion: -1,
        island: null,
        undoStack: [] as MergeSnapshot[],
        dirty: false,
        expandedFolds: new Set<number>(),
      };
      if (versions.kind !== "text") {
        return {
          ...meta,
          fallback: versions,
          ours: EMPTY_DOC,
          theirs: EMPTY_DOC,
          result: EMPTY_DOC,
          regions: [],
          ...derive({
            ...state,
            ours: EMPTY_DOC,
            theirs: EMPTY_DOC,
            result: EMPTY_DOC,
            regions: [],
          }),
        };
      }
      const initial = buildInitialResult(
        versions.base,
        versions.ours,
        versions.theirs,
      );
      const docs = {
        ours: splitDoc(versions.ours),
        theirs: splitDoc(versions.theirs),
        result: initial.result,
        regions: initial.regions,
      };
      const next = { ...state, ...docs };
      return {
        ...meta,
        ...docs,
        fallback: null,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  setError: (message) => set({ error: message, loading: false }),

  decideRegion: (index, change) =>
    set((state) => {
      if (!state.regions[index] || state.island) return {};
      const undoStack = pushUndo(state);
      const edited = applyRegionDecision(
        state.result,
        state.regions,
        index,
        change,
      );
      const next = {
        ...state,
        result: edited.buffer,
        regions: edited.regions,
      };
      return {
        result: edited.buffer,
        regions: edited.regions,
        undoStack,
        dirty: true,
        activeRegion: index,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  stepConflict: (delta) =>
    set((state) => {
      // Walk unresolved conflicts first — that is what stepping is *for* in
      // a merge — falling back to all of them once everything is resolved.
      const pending = state.regions
        .map((region, index) => ({ region, index }))
        .filter(({ region }) => !regionResolved(region))
        .map(({ index }) => index);
      const walk =
        pending.length > 0 ? pending : state.regions.map((_, index) => index);
      if (walk.length === 0) return {};
      const current = walk.indexOf(state.activeRegion);
      const next =
        current === -1
          ? delta > 0
            ? 0
            : walk.length - 1
          : (current + delta + walk.length) % walk.length;
      return { activeRegion: walk[next] };
    }),

  activeRegionAxis: () => {
    const state = get();
    const region = state.regions[state.activeRegion];
    if (!region) return null;
    const row = displayLine(state.folds.pairO, region.start, "right");
    return paneToAxis(state.axis, "result", row);
  },

  openIsland: (line) =>
    set((state) => {
      if (state.island || state.fallback || state.loading) return {};
      const range = islandRangeAt(
        state.regions,
        line,
        state.result.lines.length,
      );
      const lines =
        range.count === 0
          ? [""]
          : state.result.lines.slice(range.start, range.start + range.count);
      return {
        island: { start: range.start, lines },
        undoStack: pushUndo(state),
      };
    }),

  openIslandForRegion: (index) =>
    set((state) => {
      const region = state.regions[index];
      if (!region || state.island) return {};
      const lines =
        region.count === 0
          ? [""]
          : state.result.lines.slice(region.start, region.start + region.count);
      return {
        island: { start: region.start, lines },
        undoStack: pushUndo(state),
        activeRegion: index,
      };
    }),

  islandLinesChanged: (lines) =>
    set((state) => {
      const { island } = state;
      if (!island) return {};
      const edited = applyIslandEdit(
        state.result,
        state.regions,
        island.start,
        island.lines.length,
        lines,
      );
      const next = {
        ...state,
        result: edited.buffer,
        regions: edited.regions,
      };
      return {
        result: edited.buffer,
        regions: edited.regions,
        island: { ...island, lines },
        dirty: true,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  commitIsland: (lines) =>
    set((state) => {
      const { island } = state;
      if (!island) return {};
      const edited = applyIslandEdit(
        state.result,
        state.regions,
        island.start,
        island.lines.length,
        lines,
      );
      // A commit that changed nothing takes its undo snapshot back with it —
      // and does not mark anything edited or dirty.
      const untouched =
        edited.buffer.lines.length === state.result.lines.length &&
        edited.buffer.lines.every((l, i) => l === state.result.lines[i]);
      if (untouched) {
        return { island: null, undoStack: state.undoStack.slice(0, -1) };
      }
      const next = {
        ...state,
        result: edited.buffer,
        regions: edited.regions,
      };
      return {
        result: edited.buffer,
        regions: edited.regions,
        island: null,
        dirty: true,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  undo: () =>
    set((state) => {
      // Not while an island is open: its textarea owns undo until commit.
      if (state.island || state.undoStack.length === 0) return {};
      const snapshot = state.undoStack[state.undoStack.length - 1];
      const next = {
        ...state,
        result: snapshot.result,
        regions: snapshot.regions,
      };
      return {
        result: snapshot.result,
        regions: snapshot.regions,
        undoStack: state.undoStack.slice(0, -1),
        dirty: state.undoStack.length > 1,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  toggleFold: (resultStart) =>
    set((state) => {
      const expandedFolds = new Set(state.expandedFolds);
      if (expandedFolds.has(resultStart)) expandedFolds.delete(resultStart);
      else expandedFolds.add(resultStart);
      return { expandedFolds, ...derive({ ...state, expandedFolds }) };
    }),

  setCollapsed: (collapsed) =>
    set((state) => {
      const expandedFolds = new Set<number>();
      return {
        collapseUnchanged: collapsed,
        expandedFolds,
        ...derive({ ...state, collapseUnchanged: collapsed, expandedFolds }),
      };
    }),

  setContextLines: (contextLines) =>
    set((state) => ({ contextLines, ...derive({ ...state, contextLines }) })),

  openFind: () =>
    set((state) => {
      const opened = { ...state, findOpen: true };
      return { findOpen: true, ...deriveFind(opened) };
    }),

  closeFind: () =>
    set((state) => ({
      findOpen: false,
      findPanes: {
        ours: { ...state.findPanes.ours, matches: [], activeMatch: -1 },
        result: { ...state.findPanes.result, matches: [], activeMatch: -1 },
        theirs: { ...state.findPanes.theirs, matches: [], activeMatch: -1 },
      },
      activeFindPane: null,
    })),

  setFindQuery: (pane, query) =>
    set((state) => updatePaneFind(state, pane, { query })),

  toggleFindCase: (pane) =>
    set((state) =>
      updatePaneFind(state, pane, {
        caseSensitive: !state.findPanes[pane].caseSensitive,
      }),
    ),

  toggleFindWord: (pane) =>
    set((state) =>
      updatePaneFind(state, pane, {
        wholeWord: !state.findPanes[pane].wholeWord,
      }),
    ),

  toggleFindRegex: (pane) =>
    set((state) =>
      updatePaneFind(state, pane, { regex: !state.findPanes[pane].regex }),
    ),

  stepMatch: (pane, delta) =>
    set((state) => {
      const current = state.findPanes[pane];
      if (current.matches.length === 0) return {};
      return {
        findPanes: {
          ...state.findPanes,
          [pane]: {
            ...current,
            activeMatch:
              (current.activeMatch + delta + current.matches.length) %
              current.matches.length,
          },
        },
        activeFindPane: pane,
      };
    }),

  revealActiveMatch: (pane) => {
    const state = get();
    const current = state.findPanes[pane];
    const match = current.matches[current.activeMatch];
    if (!match) return;
    const folds = paneFolds(state.folds, pane);
    const hiddenIn = folds.find((fold) => {
      const span = PANE_SIDE[pane] === "left" ? fold.left : fold.right;
      return match.line >= span.start && match.line < span.start + span.count;
    });
    // Expansion keys on the result start line, which pair O's right span
    // carries; pair T mirrors the same runs at the same indices.
    if (hiddenIn) {
      const index = folds.indexOf(hiddenIn);
      const pairO = state.folds.pairO[index];
      if (pairO) state.toggleFold(pairO.right.start);
    }
  },

  activeMatchAxis: (pane) => {
    const state = get();
    const current = state.findPanes[pane];
    const match = current.matches[current.activeMatch];
    if (!match) return null;
    const row = displayLine(
      paneFolds(state.folds, pane),
      match.line,
      PANE_SIDE[pane],
    );
    return paneToAxis(state.axis, pane, row);
  },

  mergedText: () => joinDoc(get().result),
}));

/** One bar changed: re-search that pane only, and hand it the active box. */
function updatePaneFind(
  state: MergeStoreState,
  pane: MergePane,
  change: Partial<
    Pick<SideFindState, "query" | "caseSensitive" | "wholeWord" | "regex">
  >,
): Partial<MergeStoreState> {
  const next = recomputePane(
    paneLines(state, pane),
    pane,
    { ...state.findPanes[pane], ...change },
    state.findOpen,
  );
  return {
    findPanes: { ...state.findPanes, [pane]: next },
    activeFindPane: pane,
  };
}

export type { ConflictRegion, FindMatch };
