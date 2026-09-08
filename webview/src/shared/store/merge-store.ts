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
  computeChunks,
  type DiffChunk,
  displayLine,
  type FoldEnd,
  type FoldRegion,
  type FoldReveal,
  foldStep,
  revealEnd,
} from "../../diff/utils/diff-model";
import { type FindMatch, sideMatches } from "../../diff/utils/find";
import {
  applyRegionDecision,
  buildInitialResult,
  buildMergeAxis,
  type ConflictRegion,
  classifyRegion,
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
  remapLineKeyMap,
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

/** The side that changed the base, when exactly one of them did. */
function sideThatChanged(region: ConflictRegion): "ours" | "theirs" | null {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((line, index) => line === b[index]);
  const oursChanged = !same(region.ours, region.base);
  const theirsChanged = !same(region.theirs, region.base);
  if (oursChanged && !theirsChanged) return "ours";
  if (theirsChanged && !oursChanged) return "theirs";
  return null;
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
  /**
   * Folds opened part of the way, by result start line: what each has given
   * up at its head and tail. One map serves both pair lists, which carry the
   * same runs under the same keys, so a reveal shrinks them identically.
   */
  foldReveals: ReadonlyMap<number, FoldReveal>;
  /** Index into `regions` of the conflict the stepper is on. */
  activeRegion: number;

  /**
   * The editor: cursor and selection over the result buffer, the visual goal
   * column vertical movement carries, and the live composition range while an
   * IME is mid-composition. Null cursor means the editor is unfocused.
   */
  cursor: EditorSelection | null;
  goalVisual: number | null;
  composition: {
    start: Position;
    endLine: number;
    /** Whether the session's history step has been recorded yet. */
    recorded: boolean;
  } | null;
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
      | { action: "revert" }
      | { action: "auto" },
  ) => void;
  stepConflict: (delta: number) => void;
  /**
   * Take every region only one side actually changed — IntelliJ's "apply
   * non-conflicting changes". `side` narrows it to one flank.
   */
  applyNonConflicting: (side?: "ours" | "theirs") => void;
  /**
   * Combine both sides wherever their edits do not overlap — the magic wand.
   * Genuine conflicts are left for the user.
   */
  resolveAutomatically: () => void;
  /** How many regions each bulk action would still act on. */
  autoResolvableCount: () => number;
  nonConflictingCount: (side?: "ours" | "theirs") => number;
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

  /** Expand or re-collapse one fold whole, by its result start line. */
  toggleFold: (key: number) => void;
  /**
   * Open a fold one step further from the end nearest the result caret.
   * Reports what that did to the result caret in the rows the result pane
   * renders, as the diff store's does.
   */
  revealFold: (key: number) => MergeRevealShift;
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
  foldReveals: ReadonlyMap<number, FoldReveal>;
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
    // The pair lists are parallel; expansion and reveals are keyed on the
    // hidden run's result start line, which both pairs agree on by
    // construction, so one filter and one reveal map shrink both alike.
    const keep = computed.pairO.map(
      (fold) => !state.expandedFolds.has(fold.key),
    );
    folds = {
      pairO: applyReveals(
        computed.pairO.filter((_, i) => keep[i]),
        state.foldReveals,
      ),
      pairT: applyReveals(
        computed.pairT.filter((_, i) => keep[i]),
        state.foldReveals,
      ),
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
  const opened = expandFolds(
    state,
    intersecting.map((fold) => fold.key),
  );
  return { ...opened, ...derive({ ...state, ...opened }) };
}

/**
 * The fold state with `keys` opened whole. An expanded fold keeps no
 * partial reveal: dropping the entry lets a re-collapse bring the run back
 * complete, and keeps the toolbar's "everything is folded" reading honest.
 */
function expandFolds(
  state: Pick<MergeStoreState, "expandedFolds" | "foldReveals">,
  keys: Iterable<number>,
): Pick<MergeStoreState, "expandedFolds" | "foldReveals"> {
  const expandedFolds = new Set(state.expandedFolds);
  const foldReveals = new Map(state.foldReveals);
  for (const key of keys) {
    expandedFolds.add(key);
    foldReveals.delete(key);
  }
  return { expandedFolds, foldReveals };
}

/**
 * Which end of a fold the next click opens, for a pane's fold rows: the end
 * nearest the result caret. Every pane's folds mirror the same result runs,
 * so the result caret is the one reference whichever pane was clicked; the
 * result span is pair O's right and pair T's left.
 */
export function mergeFoldRevealEnd(
  state: Pick<MergeStoreState, "cursor">,
  pane: MergePane,
  fold: FoldRegion,
): FoldEnd {
  return revealEnd(
    fold,
    pane === "theirs" ? "left" : "right",
    state.cursor?.head.line ?? null,
  );
}

/** What a staged reveal did to the result caret, in rendered result rows. */
export interface MergeRevealShift {
  /** The row that caret was rendered on before the reveal; null with none. */
  caretRow: number | null;
  /** How many rows the reveal pushed that caret down. */
  rows: number;
}

/**
 * Which row of the result pane the caret renders on, for holding it still
 * through a reveal. Deliberately not an axis position: the axis maps to pane
 * rows at a slope that varies segment by segment (zero where the result pane
 * is parked through a gap), so an axis delta is not the row delta the caret
 * actually moved by.
 */
function caretResultRow(
  state: Pick<MergeStoreState, "cursor" | "folds">,
): number | null {
  const line = state.cursor?.head.line;
  if (line === undefined) return null;
  return displayLine(state.folds.pairO, line, "right");
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
  // A collapsed selection replaced by nothing changes nothing: it must not
  // resolve the region under the caret, dirty the buffer, or remap anything.
  // A non-collapsed deletion with empty text is still a real edit.
  if (text === "" && isCaret(selection)) {
    return {
      patch: {},
      caret: clampPosition(state.result.lines, selection.head),
    };
  }
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
  const foldReveals = remapLineKeyMap(state.foldReveals, splice);
  const next = { ...state, result, regions, expandedFolds, foldReveals };
  return {
    patch: {
      result,
      regions,
      expandedFolds,
      foldReveals,
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
  foldReveals: new Map<number, FoldReveal>(),
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
        foldReveals: new Map<number, FoldReveal>(),
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
            ...meta,
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
      const next = { ...state, ...meta, ...docs };
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
      const foldReveals = remapLineKeyMap(state.foldReveals, splice);
      const next = {
        ...state,
        result: edited.buffer,
        regions: edited.regions,
        expandedFolds,
        foldReveals,
      };
      return {
        result: edited.buffer,
        regions: edited.regions,
        expandedFolds,
        foldReveals,
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

  applyNonConflicting: (side) => {
    const { regions, decideRegion } = get();
    // Apply from the last region backwards: each decision splices the buffer,
    // and later indices would otherwise shift under us.
    for (let index = regions.length - 1; index >= 0; index--) {
      const region = regions[index];
      if (regionResolved(region)) continue;
      if (classifyRegion(region) !== "one-side") continue;
      const changedSide = sideThatChanged(region);
      if (!changedSide) continue;
      if (side && changedSide !== side) continue;
      decideRegion(index, { action: "accept", side: changedSide });
    }
  },

  resolveAutomatically: () => {
    const { regions, decideRegion } = get();
    for (let index = regions.length - 1; index >= 0; index--) {
      const region = regions[index];
      if (regionResolved(region)) continue;
      if (classifyRegion(region) !== "auto") continue;
      decideRegion(index, { action: "auto" });
    }
  },

  autoResolvableCount: () =>
    get().regions.filter(
      (region) => !regionResolved(region) && classifyRegion(region) === "auto",
    ).length,

  nonConflictingCount: (side) =>
    get().regions.filter((region) => {
      if (regionResolved(region)) return false;
      if (classifyRegion(region) !== "one-side") return false;
      const changed = sideThatChanged(region);
      return changed !== null && (!side || changed === side);
    }).length,

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
      // The head anchors the live composition range: moving it mid-session
      // would make the next update replace an arbitrary span.
      if (state.fallback || state.loading || state.composition) return {};
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
      // One history step for the whole composition session — recorded lazily
      // on the first update that changes anything, so a session cancelled
      // before producing text leaves no undo step behind. A selection is
      // consumed as the session opens (a real change, recorded at once); the
      // composition range then starts collapsed where it stood.
      if (isCaret(state.cursor)) {
        const start = clampPosition(state.result.lines, state.cursor.head);
        return {
          composition: { start, endLine: start.line, recorded: false },
        };
      }
      state.history.record(snapshotOf(state), null, Date.now());
      const { patch, caret } = applyEditToState(state, state.cursor, "");
      return {
        ...patch,
        composition: { start: caret, endLine: caret.line, recorded: true },
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  updateComposition: (text) =>
    set((state) => {
      const { composition, cursor } = state;
      if (!composition || !cursor) return {};
      let recorded = composition.recorded;
      if (!recorded && text !== "") {
        state.history.record(snapshotOf(state), null, Date.now());
        recorded = true;
      }
      const { patch, caret } = applyEditToState(
        state,
        { anchor: composition.start, head: cursor.head },
        text,
      );
      return {
        ...patch,
        composition: {
          start: composition.start,
          endLine: caret.line,
          recorded,
        },
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  endComposition: (text) =>
    set((state) => {
      const { composition, cursor } = state;
      if (!composition || !cursor) return {};
      if (!composition.recorded && text !== "") {
        state.history.record(snapshotOf(state), null, Date.now());
      }
      const { patch } = applyEditToState(
        state,
        { anchor: composition.start, head: cursor.head },
        text,
      );
      return {
        ...patch,
        composition: null,
        canUndo: state.history.canUndo,
        canRedo: state.history.canRedo,
      };
    }),

  editRegionByHand: (index) =>
    set((state) => {
      const region = state.regions[index];
      if (!region || state.composition) return {};
      if (region.count === 0) {
        // An empty slot has no line to put a caret on: give it one, which is
        // itself the hand-edit that resolves it — and one undo step away.
        state.history.record(snapshotOf(state), null, Date.now());
        if (region.start >= state.result.lines.length) {
          // A slot at EOF sits past the last line, where applyTextEdit's
          // clamp would split the last line instead: append the owned line
          // directly, which also keeps an empty document to one line.
          const lines = [...state.result.lines, ""];
          const result: TextDoc = {
            lines,
            trailingNewline: state.result.trailingNewline,
          };
          const start = lines.length - 1;
          const regions = state.regions.map((r, i) =>
            i === index ? { ...r, start, count: 1, edited: true } : r,
          );
          const next = { ...state, result, regions } as MergeStoreState;
          return {
            result,
            regions,
            cursor: caretAt(start, 0),
            goalVisual: null,
            dirty: true,
            activeRegion: index,
            canUndo: state.history.canUndo,
            canRedo: state.history.canRedo,
            ...derive(next),
            ...deriveFind(next),
          };
        }
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

  toggleFold: (key) =>
    set((state) => {
      // Either way the fold's partial reveal is spent: expanding opens the
      // whole run, and re-collapsing brings the whole run back.
      const foldReveals = new Map(state.foldReveals);
      foldReveals.delete(key);
      const expandedFolds = new Set(state.expandedFolds);
      if (expandedFolds.has(key)) expandedFolds.delete(key);
      else expandedFolds.add(key);
      const opened = { expandedFolds, foldReveals };
      return { ...opened, ...derive({ ...state, ...opened }) };
    }),

  revealFold: (key) => {
    const state = get();
    const fold = state.folds.pairO.find((candidate) => candidate.key === key);
    if (!fold) return { caretRow: null, rows: 0 };
    const step = foldStep(fold, mergeFoldRevealEnd(state, "result", fold));
    let opened: Pick<MergeStoreState, "expandedFolds" | "foldReveals">;
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
    const caretRow = caretResultRow(state);
    const after = caretResultRow({ ...state, ...patch });
    return {
      caretRow,
      rows: caretRow === null || after === null ? 0 : after - caretRow,
    };
  },

  setCollapsed: (collapsed) =>
    set((state) => {
      const forgotten = {
        expandedFolds: new Set<number>(),
        foldReveals: new Map<number, FoldReveal>(),
      };
      return {
        collapseUnchanged: collapsed,
        ...forgotten,
        ...derive({ ...state, collapseUnchanged: collapsed, ...forgotten }),
      };
    }),

  setContextLines: (contextLines) =>
    set((state) => {
      // The runs' edges move with the context; what was revealed of a run
      // no longer names the same lines, so the reveals start over.
      const foldReveals = new Map<number, FoldReveal>();
      return {
        contextLines,
        foldReveals,
        ...derive({ ...state, contextLines, foldReveals }),
      };
    }),

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
    if (hiddenIn) state.toggleFold(hiddenIn.key);
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
