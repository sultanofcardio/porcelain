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
  computeChunks,
  type DiffChunk,
  displayLine,
} from "../../diff/utils/diff-model";
import { type FindMatch, sideMatches } from "../../diff/utils/find";
import {
  applyRegionDecision,
  buildInitialResult,
  buildMergeAxis,
  type ConflictRegion,
  computeMergeFolds,
  flankRegionKinds,
  joinDoc,
  type MergeAxisMap,
  type MergeFolds,
  type MergeLineKind,
  type MergePane,
  paneToAxis,
  regionResolved,
  remapRegionsForEdit,
  resultRegionKinds,
  splitDoc,
  type TextDoc,
} from "../../merge/utils/merge-model";
import type { FileVersionsResult } from "../bridge/types";
import {
  type LineSplice,
  remapLineKeys,
  type SideFindState,
} from "./diff-store";

/**
 * The rebuilt merge editor's store: one result buffer, a region list over it,
 * and two live 2-way diffs against the flanks — everything else (folds, the
 * axis, the paints, the counts) is derived and rebuilt wholesale by
 * `derive()`, the same shape the diff store uses.
 *
 * Since the hand-test revision, the result pane is a full editor: a cursor,
 * free-form edits through `editAt`, and one history covering typed edits and
 * structural acts (accepts, ignores, reverts) alike — undo and redo walk a
 * single timeline, the way an editor's should.
 */

export type MergeFallbackInfo =
  | { kind: "binary"; bytes: number }
  | { kind: "tooLarge"; lines: number; limit: number }
  | { kind: "unreadable"; reason: string };

interface MergeSnapshot {
  result: TextDoc;
  regions: ConflictRegion[];
  cursor: EditorSelection | null;
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

  /**
   * The editor: cursor and selection over the result buffer, the visual goal
   * column vertical movement carries, and the live composition range while an
   * IME is mid-composition. Null cursor means the editor is unfocused.
   */
  cursor: EditorSelection | null;
  goalVisual: number | null;
  composition: { start: Position; endLine: number } | null;
  /** One timeline for typed edits and structural acts alike. */
  history: EditHistory<MergeSnapshot>;
  canUndo: boolean;
  canRedo: boolean;

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

  /** Place the cursor; folds hiding it expand so the caret is never invisible. */
  setCursor: (
    selection: EditorSelection | null,
    goalVisual?: number | null,
  ) => void;
  /**
   * The one editing primitive: replace `selection` with `text`. Regions the
   * edit touches are resolved by it and absorb its range; everything keyed on
   * result lines below shifts. `coalesceKey` groups typing runs into single
   * undo steps; null records a discrete step.
   */
  editAt: (
    selection: EditorSelection,
    text: string,
    coalesceKey: string | null,
  ) => void;
  /** IME composition: one history step at begin, live replaces until end. */
  beginComposition: () => void;
  updateComposition: (text: string) => void;
  endComposition: (text: string) => void;
  /** The ✎ verb: put the caret in a region (giving an empty slot a line). */
  editRegionByHand: (index: number) => void;
  undo: () => void;
  redo: () => void;

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
  revealSeq: 0,
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
  // The inverse of `splitLines` for a non-empty document is join plus a
  // trailing "\n" — a bare join makes a trailing empty line indistinguishable
  // from none, and the chunk lists stop matching the panes' line counts.
  const textOf = (lines: readonly string[]) =>
    lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  const oursText = textOf(state.ours.lines);
  const theirsText = textOf(state.theirs.lines);
  const resultText = textOf(state.result.lines);

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

/**
 * One pane's match list, refreshed against its text. A buffer splice must not
 * reset the user's stepped position or fire the reveal: the previous active
 * match is re-located by its (line, start) identity in the new list, and
 * `revealSeq` is left alone — only user-initiated actions bump it.
 */
function recomputePane(
  lines: readonly string[],
  pane: MergePane,
  paneState: SideFindState,
  open: boolean,
  splice?: LineSplice,
): SideFindState {
  const matches =
    open && paneState.query !== ""
      ? sideMatches(lines, PANE_SIDE[pane], paneState.query, {
          caseSensitive: paneState.caseSensitive,
          wholeWord: paneState.wholeWord,
          regex: paneState.regex,
        })
      : [];
  // The previous match's line shifts by the splice's delta when it sat at or
  // below the splice — relocating by the raw coordinates would lock onto
  // whatever occurrence happens to sit there now.
  const previous = paneState.matches[paneState.activeMatch];
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
    ...paneState,
    matches,
    activeMatch: relocated >= 0 ? relocated : matches.length > 0 ? 0 : -1,
  };
}

function deriveFind(
  state: MergeStoreState,
  splice?: LineSplice,
): {
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
        // Only the result buffer ever splices; the flanks are immutable.
        splice,
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

/** The state a mutation is about to replace, for the history timeline. */
function snapshotOf(state: MergeStoreState): MergeSnapshot {
  return { result: state.result, regions: state.regions, cursor: state.cursor };
}

/**
 * Expand any fold hiding part of a result range the editor is about to own —
 * a caret or an edit inside a collapsed run would otherwise operate on
 * invisible content.
 */
function expandFoldsForRange(
  state: MergeStoreState,
  start: number,
  count: number,
): Partial<MergeStoreState> {
  const intersecting = state.folds.pairO.filter(
    (fold) =>
      fold.right.start < start + Math.max(1, count) &&
      start < fold.right.start + fold.right.count,
  );
  if (intersecting.length === 0) return {};
  const expandedFolds = new Set(state.expandedFolds);
  for (const fold of intersecting) expandedFolds.add(fold.right.start);
  return { expandedFolds, ...derive({ ...state, expandedFolds }) };
}

/**
 * Apply one text edit to the buffer and carry every dependent structure with
 * it: regions (touched ones resolve and absorb), fold-expansion keys, the
 * find walk, the derived world, and the cursor. The shared tail of `editAt`
 * and the composition actions.
 */
function applyEditToState(
  state: MergeStoreState,
  selection: EditorSelection,
  text: string,
): { patch: Partial<MergeStoreState>; caret: Position } {
  const edit = applyTextEdit(state.result.lines, selection, text);
  const result: TextDoc = {
    lines: edit.lines,
    trailingNewline: state.result.trailingNewline,
  };
  const regions = remapRegionsForEdit(
    state.regions,
    edit.replaced.start.line,
    edit.replaced.end.line,
    edit.lineDelta,
  );
  const splice: LineSplice = {
    start: edit.replaced.start.line,
    end: edit.replaced.end.line + 1,
    delta: edit.lineDelta,
  };
  const expandedFolds = remapLineKeys(state.expandedFolds, splice);
  const next = { ...state, result, regions, expandedFolds };
  return {
    patch: {
      result,
      regions,
      expandedFolds,
      cursor: caretAt(edit.caret.line, edit.caret.col),
      goalVisual: null,
      dirty: true,
      ...derive(next),
      ...deriveFind(next, splice),
    },
    caret: edit.caret,
  };
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

  cursor: null,
  goalVisual: null,
  composition: null,
  history: new EditHistory<MergeSnapshot>(),
  canUndo: false,
  canRedo: false,

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
        cursor: null,
        goalVisual: null,
        composition: null,
        history: new EditHistory<MergeSnapshot>(),
        canUndo: false,
        canRedo: false,
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
      const region = state.regions[index];
      if (!region || state.composition) return {};
      state.history.record(snapshotOf(state), null, Date.now());
      const edited = applyRegionDecision(
        state.result,
        state.regions,
        index,
        change,
      );
      const splice: LineSplice = {
        start: region.start,
        end: region.start + region.count,
        delta: edited.buffer.lines.length - state.result.lines.length,
      };
      const expandedFolds = remapLineKeys(state.expandedFolds, splice);
      const next = {
        ...state,
        result: edited.buffer,
        regions: edited.regions,
        expandedFolds,
      };
      return {
        result: edited.buffer,
        regions: edited.regions,
        expandedFolds,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
        dirty: true,
        activeRegion: index,
        // The buffer moved under the cursor; snap it into the new document.
        cursor: state.cursor
          ? {
              anchor: clampPosition(edited.buffer.lines, state.cursor.anchor),
              head: clampPosition(edited.buffer.lines, state.cursor.head),
            }
          : null,
        ...derive(next),
        ...deriveFind(next, splice),
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

  setCursor: (selection, goalVisual = null) =>
    set((state) => {
      if (state.fallback || state.loading) return {};
      if (!selection) return { cursor: null, goalVisual: null };
      const clamped = {
        anchor: clampPosition(state.result.lines, selection.anchor),
        head: clampPosition(state.result.lines, selection.head),
      };
      const span = ordered(clamped);
      return {
        cursor: clamped,
        goalVisual,
        ...expandFoldsForRange(
          state,
          span.start.line,
          span.end.line - span.start.line + 1,
        ),
      };
    }),

  editAt: (selection, text, coalesceKey) =>
    set((state) => {
      if (state.fallback || state.loading || state.composition) return {};
      state.history.record(snapshotOf(state), coalesceKey, Date.now());
      const { patch, caret } = applyEditToState(state, selection, text);
      const withEdit = { ...state, ...patch } as MergeStoreState;
      return {
        ...patch,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
        // The caret must land visible: a paste or newline can push it into
        // (or past) a collapsed run.
        ...expandFoldsForRange(withEdit, caret.line, 1),
      };
    }),

  beginComposition: () =>
    set((state) => {
      if (!state.cursor || state.composition) return {};
      // One history step for the whole composition session.
      state.history.record(snapshotOf(state), null, Date.now());
      // A selection is consumed as the session opens; the composition range
      // then starts collapsed where it stood.
      if (isCaret(state.cursor)) {
        const start = clampPosition(state.result.lines, state.cursor.head);
        return {
          composition: { start, endLine: start.line },
          canUndo: state.history.canUndo,
          canRedo: state.history.canRedo,
        };
      }
      const { patch, caret } = applyEditToState(state, state.cursor, "");
      return {
        ...patch,
        composition: { start: caret, endLine: caret.line },
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  updateComposition: (text) =>
    set((state) => {
      const { composition, cursor } = state;
      if (!composition || !cursor) return {};
      const { patch, caret } = applyEditToState(
        state,
        { anchor: composition.start, head: cursor.head },
        text,
      );
      return {
        ...patch,
        composition: { start: composition.start, endLine: caret.line },
      };
    }),

  endComposition: (text) =>
    set((state) => {
      const { composition, cursor } = state;
      if (!composition || !cursor) return {};
      const { patch } = applyEditToState(
        state,
        { anchor: composition.start, head: cursor.head },
        text,
      );
      return { ...patch, composition: null };
    }),

  editRegionByHand: (index) =>
    set((state) => {
      const region = state.regions[index];
      if (!region || state.composition) return {};
      if (region.count === 0) {
        // An empty slot has no line to put a caret on: give it one, which is
        // itself the hand-edit that resolves it — and one undo step away.
        state.history.record(snapshotOf(state), null, Date.now());
        const { patch } = applyEditToState(
          state,
          caretAt(region.start, 0),
          "\n",
        );
        // The inserted line belongs to the region, not to the text below it —
        // remap treated a seam insertion as neighbouring-text physics.
        const regions = (patch.regions ?? state.regions).map((r, i) =>
          i === index
            ? { ...r, start: region.start, count: 1, edited: true }
            : r,
        );
        const next = { ...state, ...patch, regions } as MergeStoreState;
        return {
          ...patch,
          regions,
          cursor: caretAt(region.start, 0),
          activeRegion: index,
          canUndo: state.history.canUndo,
          canRedo: state.history.canRedo,
          ...derive(next),
        };
      }
      return {
        activeRegion: index,
        cursor: caretAt(region.start, 0),
        goalVisual: null,
        ...expandFoldsForRange(state, region.start, region.count),
      };
    }),

  undo: () =>
    set((state) => {
      if (state.composition) return {};
      const snapshot = state.history.undo(snapshotOf(state));
      if (!snapshot) return {};
      const next = { ...state, ...snapshot };
      return {
        ...snapshot,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
        dirty: state.history.canUndo,
        goalVisual: null,
        ...derive(next),
        ...deriveFind(next),
      };
    }),

  redo: () =>
    set((state) => {
      if (state.composition) return {};
      const snapshot = state.history.redo(snapshotOf(state));
      if (!snapshot) return {};
      const next = { ...state, ...snapshot };
      return {
        ...snapshot,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
        dirty: true,
        goalVisual: null,
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
            // Bumped even when the index wraps back onto itself, so Enter on
            // a 1/1 result still re-reveals the match after scrolling away.
            revealSeq: current.revealSeq + 1,
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
  const current = state.findPanes[pane];
  const next = recomputePane(
    paneLines(state, pane),
    pane,
    // A changed query or option starts a fresh walk from the first match.
    { ...current, ...change, matches: [], activeMatch: -1 },
    state.findOpen,
  );
  return {
    findPanes: {
      ...state.findPanes,
      [pane]: { ...next, revealSeq: current.revealSeq + 1 },
    },
    activeFindPane: pane,
  };
}

export type { ConflictRegion, FindMatch };
