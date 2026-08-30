import { diff3MergeRegions } from "node-diff3";
import {
  type DiffChunk,
  displayLine,
  type FoldRegion,
  splitLines,
} from "../../diff/utils/diff-model";

/**
 * The model behind the rebuilt 3-way merge editor.
 *
 * The design (decided at the scope review, `.lavish/merge-editor-scope.html`):
 * node-diff3 runs exactly once, to build the initial result buffer and the
 * conflict regions. From then on the editor is two live 2-way diffs sharing
 * one scroll axis — `computeChunks(ours, result)` and
 * `computeChunks(result, theirs)` — and every resolution, accept or keystroke
 * is a splice into the result buffer followed by an ordinary re-derive.
 *
 * Coordinates: pair O is (left: ours, right: result); pair T is
 * (left: result, right: theirs). The merge axis anchors on result lines, and
 * where both flanks have extra lines at the same anchor they share axis rows —
 * the gap costs `max(oursExtra, theirsExtra)`, never the sum, because the two
 * flank panes never need to avoid each other.
 */

/** Lines plus the one bit `splitLines` drops: whether the file ends in "\n". */
export interface TextDoc {
  lines: string[];
  trailingNewline: boolean;
}

export function splitDoc(text: string): TextDoc {
  return {
    lines: splitLines(text),
    trailingNewline: text === "" ? false : text.endsWith("\n"),
  };
}

/** The inverse of `splitDoc` — what Apply writes to disk. */
export function joinDoc(doc: TextDoc): string {
  if (doc.lines.length === 0) return "";
  return doc.lines.join("\n") + (doc.trailingNewline ? "\n" : "");
}

export type SideDecision = "pending" | "accepted" | "ignored";

/**
 * One conflict, anchored to the result buffer.
 *
 * `start`/`count` are the region's current range of result lines and move with
 * every splice; the ours/theirs/base slices and the flank positions are fixed
 * at load time — the flank documents never change, so neither do they.
 */
export interface ConflictRegion {
  start: number;
  count: number;
  ours: string[];
  theirs: string[];
  base: string[];
  /** Where the ours slice sits in the ours document. */
  oursStart: number;
  /** Where the theirs slice sits in the theirs document. */
  theirsStart: number;
  oursState: SideDecision;
  theirsState: SideDecision;
  /** A hand edit overlapped this region: typing is resolving. */
  edited: boolean;
}

export function regionResolved(region: ConflictRegion): boolean {
  return (
    region.edited ||
    (region.oursState !== "pending" && region.theirsState !== "pending")
  );
}

/**
 * Whether a region can be resolved without a human choosing sides.
 *
 * "one-side" means only one side actually changed the base, so taking that
 * side loses nothing. "auto" means both sides changed, but their edits do not
 * touch the same base lines, so they can be combined — what IntelliJ's magic
 * wand resolves. Anything else is a genuine conflict.
 */
export type RegionResolvability = "one-side" | "auto" | "conflict";

export function classifyRegion(region: ConflictRegion): RegionResolvability {
  const oursChanged = !sameLines(region.ours, region.base);
  const theirsChanged = !sameLines(region.theirs, region.base);
  if (!oursChanged || !theirsChanged) return "one-side";
  // Both changed. They can still be combined when neither touched a base line
  // the other also touched.
  const oursTouched = touchedBaseLines(region.base, region.ours);
  const theirsTouched = touchedBaseLines(region.base, region.theirs);
  const overlap = [...oursTouched].some((line) => theirsTouched.has(line));
  return overlap ? "conflict" : "auto";
}

/**
 * The combined content for an auto-resolvable region: each side's edit applied
 * to the base, taking whichever side changed a given base line.
 */
export function autoResolveContent(region: ConflictRegion): string[] {
  const oursTouched = touchedBaseLines(region.base, region.ours);
  const result: string[] = [];
  // Walk the base, substituting each side's version of the runs it changed.
  const oursOps = lineOps(region.base, region.ours);
  const theirsOps = lineOps(region.base, region.theirs);
  for (let index = 0; index < region.base.length; index++) {
    const fromOurs = oursOps.get(index);
    const fromTheirs = theirsOps.get(index);
    if (fromOurs !== undefined) {
      result.push(...fromOurs);
      continue;
    }
    if (fromTheirs !== undefined) {
      result.push(...fromTheirs);
      continue;
    }
    result.push(region.base[index]);
  }
  // Pure appends past the end of the base belong to whichever side made them.
  result.push(...(oursOps.get(-1) ?? []), ...(theirsOps.get(-1) ?? []));
  void oursTouched;
  return result;
}

/**
 * Base line indices a side rewrote. A side that only appended touches nothing,
 * which is what lets two appends combine.
 */
function touchedBaseLines(
  base: readonly string[],
  side: readonly string[],
): Set<number> {
  const touched = new Set<number>();
  const ops = lineOps(base, side);
  for (const index of ops.keys()) {
    if (index >= 0) touched.add(index);
  }
  return touched;
}

/**
 * Map each rewritten base line index to its replacement lines, with -1 for
 * content appended past the end. A deliberately simple prefix/suffix match:
 * shared leading and trailing lines are untouched, and what remains between
 * them is the change.
 */
function lineOps(
  base: readonly string[],
  side: readonly string[],
): Map<number, string[]> {
  const ops = new Map<number, string[]>();
  let prefix = 0;
  while (
    prefix < base.length &&
    prefix < side.length &&
    base[prefix] === side[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < side.length - prefix &&
    base[base.length - 1 - suffix] === side[side.length - 1 - suffix]
  ) {
    suffix++;
  }
  const changedBase = base.length - prefix - suffix;
  const replacement = side.slice(prefix, side.length - suffix);
  if (changedBase === 0) {
    if (replacement.length > 0) {
      // Pure insertion: attach it to the line it precedes, or to the end.
      ops.set(prefix < base.length ? prefix : -1, [
        ...replacement,
        ...(prefix < base.length ? [base[prefix]] : []),
      ]);
    }
    return ops;
  }
  ops.set(prefix, replacement);
  // Later rewritten lines are consumed by the replacement above.
  for (let index = prefix + 1; index < prefix + changedBase; index++) {
    ops.set(index, []);
  }
  return ops;
}

export interface InitialMerge {
  result: TextDoc;
  regions: ConflictRegion[];
}

/**
 * Run diff3 once and fold its verdicts into a result buffer.
 *
 * Stable regions and one-side changes are applied immediately — IntelliJ's
 * "apply non-conflicting changes", minus the button. A conflict lands as its
 * base lines, flagged pending, so the centre pane shows the common ancestor
 * until someone decides; when the base is empty the region occupies zero
 * result lines and renders as a slot between its neighbours.
 *
 * Every conflict keeps its slices whole — an empty base included. Splitting a
 * both-sides-added run around incidentally shared lines reads clever and
 * merges wrong: accept-both must append complete units, IntelliJ-style.
 */
export function buildInitialResult(
  baseText: string,
  oursText: string,
  theirsText: string,
): InitialMerge {
  const base = splitDoc(baseText);
  const ours = splitDoc(oursText);
  const theirs = splitDoc(theirsText);

  const merged = diff3MergeRegions(ours.lines, base.lines, theirs.lines);

  const lines: string[] = [];
  const regions: ConflictRegion[] = [];

  // Flank anchors come from node-diff3's own aStart/bStart, never from
  // running accumulators: one-sided changes are emitted as *stable* regions
  // whose buffer content has the changed side's length (the unchanged flank
  // consumed the base's length there), and a one-sided pure deletion emits
  // no region at all — an accumulator drifts on both, mis-anchoring every
  // later conflict's verbs, paints and connectors.
  const pushConflict = (
    oursSlice: string[],
    theirsSlice: string[],
    baseSlice: string[],
    oursAt: number,
    theirsAt: number,
  ) => {
    regions.push({
      start: lines.length,
      count: baseSlice.length,
      ours: oursSlice,
      theirs: theirsSlice,
      base: baseSlice,
      oursStart: oursAt,
      theirsStart: theirsAt,
      oursState: "pending",
      theirsState: "pending",
      edited: false,
    });
    lines.push(...baseSlice);
  };

  for (const region of merged) {
    if (region.stable) {
      lines.push(...(region.bufferContent ?? []));
      continue;
    }

    const oursSlice = region.aContent ?? [];
    const baseSlice = region.oContent ?? [];
    const theirsSlice = region.bContent ?? [];
    const oursAt = region.aStart ?? 0;
    const theirsAt = region.bStart ?? 0;
    const oursChanged = !sameLines(oursSlice, baseSlice);
    const theirsChanged = !sameLines(theirsSlice, baseSlice);

    if (!oursChanged && !theirsChanged) {
      lines.push(...baseSlice);
      continue;
    }
    if (oursChanged && !theirsChanged) {
      lines.push(...oursSlice);
      continue;
    }
    if (!oursChanged && theirsChanged) {
      lines.push(...theirsSlice);
      continue;
    }
    if (sameLines(oursSlice, theirsSlice)) {
      // Both changed identically — either side is the answer.
      lines.push(...oursSlice);
      continue;
    }

    // One region per diff3 verdict, slices kept whole — empty base included.
    // The legacy editor refined empty-base conflicts into sub-conflicts
    // around lines the sides happened to share ("}", a common call), and
    // hand-testing showed why that is wrong: accepting both sides then
    // interleaves fragments — close() { and drain() { sharing one closing
    // brace — instead of appending complete units below each other, which is
    // the IntelliJ behaviour accept-both exists for.
    pushConflict(oursSlice, theirsSlice, baseSlice, oursAt, theirsAt);
  }

  return {
    result: {
      lines,
      trailingNewline: ours.trailingNewline || theirs.trailingNewline,
    },
    regions,
  };
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What a region's result range holds for a given pair of side decisions.
 *
 * Keyed on the decision states, not on whether the accepted slices are empty:
 * an accepted flank whose slice is empty is an accepted *deletion*, and its
 * result is exactly nothing. The base slice stands in only while no flank is
 * accepted — pending/ignored mixes and revert.
 */
export function regionContent(
  region: ConflictRegion,
  oursState: SideDecision,
  theirsState: SideDecision,
): string[] {
  if (oursState !== "accepted" && theirsState !== "accepted") {
    return [...region.base];
  }
  const parts: string[] = [];
  if (oursState === "accepted") parts.push(...region.ours);
  if (theirsState === "accepted") parts.push(...region.theirs);
  return parts;
}

export interface MergeEdit {
  buffer: TextDoc;
  regions: ConflictRegion[];
}

/** Shift every region after a splice point by the splice's line delta. */
function remapAfter(
  regions: readonly ConflictRegion[],
  spliceStart: number,
  delta: number,
  touched: number,
): ConflictRegion[] {
  return regions.map((region, index) => {
    if (index === touched) return region;
    if (region.start >= spliceStart) {
      return { ...region, start: region.start + delta };
    }
    return region;
  });
}

/**
 * Apply an accept/ignore/revert decision: recompute the region's content from
 * its slices, splice it into the buffer, and remap everything below.
 *
 * Accepting one side while the other is pending decides the other side as
 * ignored — one click resolves the region, which is the legacy editor's
 * behaviour and IntelliJ's. Accepting the second side afterwards puts both
 * slices in, ours before theirs (the order the scope review fixed for v1).
 */
export function applyRegionDecision(
  buffer: TextDoc,
  regions: readonly ConflictRegion[],
  index: number,
  change:
    | { action: "accept"; side: "ours" | "theirs" }
    | { action: "ignore"; side: "ours" | "theirs" }
    | { action: "revert" }
    // Combine both sides where their edits do not overlap. Only ever issued
    // for a region `classifyRegion` calls "auto".
    | { action: "auto" },
): MergeEdit {
  const region = regions[index];
  if (!region) return { buffer, regions: [...regions] };

  if (change.action === "auto") {
    const merged = autoResolveContent(region);
    const lines = [...buffer.lines];
    lines.splice(region.start, region.count, ...merged);
    const delta = merged.length - region.count;
    const next = remapAfter(regions, region.start + 1, delta, index);
    // Both sides landed, so the region reads as resolved by decision rather
    // than by a hand edit.
    next[index] = {
      ...region,
      count: merged.length,
      oursState: "accepted",
      theirsState: "accepted",
      edited: false,
    };
    return { buffer: { ...buffer, lines }, regions: next };
  }

  let oursState = region.oursState;
  let theirsState = region.theirsState;
  if (change.action === "revert") {
    oursState = "pending";
    theirsState = "pending";
  } else if (change.side === "ours") {
    oursState = change.action === "accept" ? "accepted" : "ignored";
    if (change.action === "accept" && theirsState === "pending") {
      theirsState = "ignored";
    }
  } else {
    theirsState = change.action === "accept" ? "accepted" : "ignored";
    if (change.action === "accept" && oursState === "pending") {
      oursState = "ignored";
    }
  }

  const content = regionContent(region, oursState, theirsState);
  const lines = [...buffer.lines];
  lines.splice(region.start, region.count, ...content);
  const delta = content.length - region.count;

  const next = remapAfter(regions, region.start + 1, delta, index);
  next[index] = {
    ...region,
    count: content.length,
    oursState,
    theirsState,
    edited: false,
  };
  return { buffer: { ...buffer, lines }, regions: next };
}

/**
 * Remap the regions after a free-form editor edit replaced the inclusive
 * line span [replacedStart, replacedEnd] and changed the line count by
 * `lineDelta`.
 *
 * A region the edit touches is resolved by it — typing is resolving — and
 * absorbs the edit: its range becomes the union of itself and the edit's
 * result. Regions entirely below shift by the delta. A zero-length slot
 * sitting exactly at the edit's start line neither resolves nor moves: the
 * edit happened to the content at that line, and the seam before it stays
 * where it is — a conflict must never be silently resolved by an edit the
 * user aimed at neighbouring text.
 */
export function remapRegionsForEdit(
  regions: readonly ConflictRegion[],
  replacedStart: number,
  replacedEnd: number,
  lineDelta: number,
): ConflictRegion[] {
  return regions.map((region) => {
    const start = region.start;
    const end = region.start + region.count;

    const touched =
      region.count > 0
        ? start <= replacedEnd && replacedStart < end
        : replacedStart < start && start <= replacedEnd;

    if (touched) {
      const unionStart = Math.min(start, replacedStart);
      const unionEnd = Math.max(end, replacedEnd + 1);
      return {
        ...region,
        start: unionStart,
        count: Math.max(0, unionEnd - unionStart + lineDelta),
        edited: true,
      };
    }
    if (start > replacedEnd) {
      return { ...region, start: region.start + lineDelta };
    }
    return region;
  });
}

/* ── tri-pane folds ─────────────────────────────────────────────────────── */

export interface MergeFolds {
  /** Fold regions in pair-O coordinates (left: ours, right: result). */
  pairO: FoldRegion[];
  /** The same runs in pair-T coordinates (left: result, right: theirs). */
  pairT: FoldRegion[];
}

interface EqualRun {
  result: { start: number; end: number };
  oursDelta: number;
  theirsDelta: number;
  chunkO: number;
  chunkT: number;
}

/**
 * A run folds only where all three panes agree — equal in *both* chunk lists.
 * Each fold is emitted twice, once per pair, so `displayLine` and the axis
 * arithmetic work per pair exactly as they do in the 2-way viewer. A fold may
 * be a sub-range of its chunk (the intersection can be narrower than either
 * equal chunk); the fold-aware axis span subtracts hidden lines from the
 * chunk, which holds for sub-ranges too.
 */
export function computeMergeFolds(
  chunksOurs: readonly DiffChunk[],
  chunksTheirs: readonly DiffChunk[],
  resultLineCount: number,
  options: { contextLines?: number; minimumLines?: number } = {},
): MergeFolds {
  const context = options.contextLines ?? 3;
  const minimum = options.minimumLines ?? context * 2 + 2;

  const runs: EqualRun[] = [];
  for (const [indexO, chunkO] of chunksOurs.entries()) {
    if (chunkO.kind !== "equal") continue;
    for (const [indexT, chunkT] of chunksTheirs.entries()) {
      if (chunkT.kind !== "equal") continue;
      // Pair O addresses result on its right, pair T on its left.
      const start = Math.max(chunkO.right.start, chunkT.left.start);
      const end = Math.min(
        chunkO.right.start + chunkO.right.count,
        chunkT.left.start + chunkT.left.count,
      );
      if (end <= start) continue;
      runs.push({
        result: { start, end },
        oursDelta: chunkO.left.start - chunkO.right.start,
        theirsDelta: chunkT.right.start - chunkT.left.start,
        chunkO: indexO,
        chunkT: indexT,
      });
    }
  }
  runs.sort((a, b) => a.result.start - b.result.start);

  const pairO: FoldRegion[] = [];
  const pairT: FoldRegion[] = [];
  for (const run of runs) {
    const length = run.result.end - run.result.start;
    if (length < minimum) continue;
    // A run keeps no context on an edge only when nothing changed beyond it
    // in *either* pair — the same first/last-chunk rule the 2-way folds use.
    // Touching result line 0 or EOF is not enough: a flank-only chunk can
    // still anchor changes there, and those deserve visible context.
    const leading =
      run.chunkO === 0 && run.chunkT === 0 && run.result.start === 0
        ? 0
        : context;
    const trailing =
      run.chunkO === chunksOurs.length - 1 &&
      run.chunkT === chunksTheirs.length - 1 &&
      run.result.end === resultLineCount
        ? 0
        : context;
    const hidden = length - leading - trailing;
    if (hidden <= 0) continue;
    const start = run.result.start + leading;
    pairO.push({
      chunkIndex: run.chunkO,
      left: { start: start + run.oursDelta, count: hidden },
      right: { start, count: hidden },
      hiddenLines: hidden,
    });
    pairT.push({
      chunkIndex: run.chunkT,
      left: { start, count: hidden },
      right: { start: start + run.theirsDelta, count: hidden },
      hiddenLines: hidden,
    });
  }
  return { pairO, pairT };
}

/* ── the merge axis ─────────────────────────────────────────────────────── */

/**
 * One stretch of the shared scroll coordinate. All positions and spans are
 * display rows (fold-collapsed). A segment with `result.span > 0` carries
 * result lines; one with `result.span === 0` is a gap — flank-only lines,
 * where the axis width is the larger flank's need and the result stands
 * still.
 */
export interface MergeSegment {
  axisStart: number;
  axisSpan: number;
  result: { start: number; span: number };
  ours: { start: number; span: number };
  theirs: { start: number; span: number };
}

export interface MergeAxisMap {
  segments: MergeSegment[];
  length: number;
  /** Total display rows per pane, for windowing bounds. */
  resultRows: number;
  oursRows: number;
  theirsRows: number;
}

export interface MergeOffsets {
  result: number;
  ours: number;
  theirs: number;
}

/**
 * Fractional source position of `resultPos` on the other side of a pair.
 *
 * At a chunk boundary the answer is ambiguous when flank-only chunks (zero
 * result lines) anchor exactly there: `bias` decides. An interval *end* stops
 * before them — their lines belong to the gap segment, not the interval — and
 * an interval *start* resumes after them.
 */
function pairCounterpart(
  chunks: readonly DiffChunk[],
  resultPos: number,
  resultSide: "left" | "right",
  bias: "start" | "end",
): number {
  let fallback = 0;
  for (const chunk of chunks) {
    const own = resultSide === "left" ? chunk.left : chunk.right;
    const other = resultSide === "left" ? chunk.right : chunk.left;
    if (bias === "end" && own.start >= resultPos) return fallback;
    if (resultPos < own.start + own.count) {
      if (own.count === 0) return other.start;
      const progress = (resultPos - own.start) / own.count;
      return other.start + progress * other.count;
    }
    fallback = other.start + other.count;
  }
  return fallback;
}

/**
 * Build the shared axis from the two chunk lists and the tri-pane folds.
 *
 * Cut the result document at every chunk boundary from either pair; each
 * interval becomes a segment whose axis width is the *widest* pane's display
 * span through it (the 2-way `axisSpan` rule, extended to three). Flank-only
 * chunks (a pair chunk with no result lines) become gap segments at their
 * anchor — and when both flanks anchor extras at the same point, one gap
 * carries both, `max` wide.
 */
export function buildMergeAxis(
  resultLineCount: number,
  chunksOurs: readonly DiffChunk[],
  chunksTheirs: readonly DiffChunk[],
  folds: MergeFolds,
): MergeAxisMap {
  const cuts = new Set<number>([0, resultLineCount]);
  for (const chunk of chunksOurs) {
    cuts.add(chunk.right.start);
    cuts.add(chunk.right.start + chunk.right.count);
  }
  for (const chunk of chunksTheirs) {
    cuts.add(chunk.left.start);
    cuts.add(chunk.left.start + chunk.left.count);
  }
  const points = [...cuts]
    .filter((cut) => cut >= 0 && cut <= resultLineCount)
    .sort((a, b) => a - b);

  // Flank-only extras, keyed by the result line they anchor before.
  const oursExtraAt = new Map<number, { lines: number; source: number }>();
  for (const chunk of chunksOurs) {
    if (chunk.right.count !== 0 || chunk.left.count === 0) continue;
    const existing = oursExtraAt.get(chunk.right.start);
    oursExtraAt.set(chunk.right.start, {
      lines: (existing?.lines ?? 0) + chunk.left.count,
      source: existing?.source ?? chunk.left.start,
    });
  }
  const theirsExtraAt = new Map<number, { lines: number; source: number }>();
  for (const chunk of chunksTheirs) {
    if (chunk.left.count !== 0 || chunk.right.count === 0) continue;
    const existing = theirsExtraAt.get(chunk.left.start);
    theirsExtraAt.set(chunk.left.start, {
      lines: (existing?.lines ?? 0) + chunk.right.count,
      source: existing?.source ?? chunk.right.start,
    });
  }

  const resultDisplay = (line: number) =>
    displayLine(folds.pairO, line, "right");
  const oursDisplay = (source: number) => {
    const whole = Math.floor(source);
    return displayLine(folds.pairO, whole, "left") + (source - whole);
  };
  const theirsDisplay = (source: number) => {
    const whole = Math.floor(source);
    return displayLine(folds.pairT, whole, "right") + (source - whole);
  };

  const segments: MergeSegment[] = [];
  let axis = 0;

  for (let i = 0; i < points.length; i++) {
    const at = points[i];

    const oursGap = oursExtraAt.get(at);
    const theirsGap = theirsExtraAt.get(at);
    if (oursGap || theirsGap) {
      const oursSpan = oursGap?.lines ?? 0;
      const theirsSpan = theirsGap?.lines ?? 0;
      const span = Math.max(oursSpan, theirsSpan);
      segments.push({
        axisStart: axis,
        axisSpan: span,
        result: { start: resultDisplay(at), span: 0 },
        ours: {
          start: oursGap
            ? oursDisplay(oursGap.source)
            : oursDisplay(pairCounterpart(chunksOurs, at, "right", "end")),
          span: oursSpan,
        },
        theirs: {
          start: theirsGap
            ? theirsDisplay(theirsGap.source)
            : theirsDisplay(pairCounterpart(chunksTheirs, at, "left", "end")),
          span: theirsSpan,
        },
      });
      axis += span;
    }

    const next = points[i + 1];
    if (next === undefined || next <= at) continue;

    const rStart = resultDisplay(at);
    const rSpan = resultDisplay(next) - rStart;
    const oursA = oursDisplay(
      pairCounterpart(chunksOurs, at, "right", "start"),
    );
    const oursB = oursDisplay(
      pairCounterpart(chunksOurs, next, "right", "end"),
    );
    const theirsA = theirsDisplay(
      pairCounterpart(chunksTheirs, at, "left", "start"),
    );
    const theirsB = theirsDisplay(
      pairCounterpart(chunksTheirs, next, "left", "end"),
    );
    const span = Math.max(rSpan, oursB - oursA, theirsB - theirsA);
    if (span <= 0) continue;
    segments.push({
      axisStart: axis,
      axisSpan: span,
      result: { start: rStart, span: rSpan },
      ours: { start: oursA, span: oursB - oursA },
      theirs: { start: theirsA, span: theirsB - theirsA },
    });
    axis += span;
  }

  const last = segments[segments.length - 1];
  return {
    segments,
    length: axis,
    resultRows: last ? last.result.start + last.result.span : 0,
    oursRows: last ? last.ours.start + last.ours.span : 0,
    theirsRows: last ? last.theirs.start + last.theirs.span : 0,
  };
}

/** Where each pane sits when the shared axis is at `position`. */
export function axisToOffsets(
  map: MergeAxisMap,
  position: number,
): MergeOffsets {
  if (map.segments.length === 0) {
    const p = Math.max(0, position);
    return { result: p, ours: p, theirs: p };
  }
  if (position <= 0) {
    const first = map.segments[0];
    return {
      result: first.result.start,
      ours: first.ours.start,
      theirs: first.theirs.start,
    };
  }
  for (const segment of map.segments) {
    if (position < segment.axisStart + segment.axisSpan) {
      const progress =
        segment.axisSpan === 0
          ? 0
          : (position - segment.axisStart) / segment.axisSpan;
      return {
        result: segment.result.start + progress * segment.result.span,
        ours: segment.ours.start + progress * segment.ours.span,
        theirs: segment.theirs.start + progress * segment.theirs.span,
      };
    }
  }
  const overshoot = position - map.length;
  return {
    result: map.resultRows + overshoot,
    ours: map.oursRows + overshoot,
    theirs: map.theirsRows + overshoot,
  };
}

export type MergePane = "ours" | "result" | "theirs";

/**
 * The axis position that puts one pane's display row at the top — for jumps:
 * step-conflict, find, the stripe. A row at a gap edge resolves to the gap's
 * far side, so jumping to it reveals the flank-only lines.
 */
export function paneToAxis(
  map: MergeAxisMap,
  pane: MergePane,
  displayRow: number,
): number {
  let best = 0;
  for (const segment of map.segments) {
    const side = segment[pane];
    if (side.span === 0) {
      if (displayRow <= side.start) return segment.axisStart;
      best = segment.axisStart + segment.axisSpan;
      continue;
    }
    if (displayRow < side.start + side.span) {
      const progress = Math.max(0, (displayRow - side.start) / side.span);
      return segment.axisStart + progress * segment.axisSpan;
    }
    best = segment.axisStart + segment.axisSpan;
  }
  return best;
}

/* ── presentation helpers ───────────────────────────────────────────────── */

/** The css kind painted over one result line, when any. */
export type MergeLineKind = "conflict" | "resolved";

/**
 * Which result lines wear region colour. Pending regions paint their base
 * lines as conflict; resolved ones keep a quieter mark on the lines the
 * decision produced, so "handled" stays visible without shouting.
 */
export function resultRegionKinds(
  regions: readonly ConflictRegion[],
): Map<number, MergeLineKind> {
  const kinds = new Map<number, MergeLineKind>();
  for (const region of regions) {
    const kind: MergeLineKind = regionResolved(region)
      ? "resolved"
      : "conflict";
    for (let i = 0; i < region.count; i++) kinds.set(region.start + i, kind);
  }
  return kinds;
}

/**
 * Where a conflict region sits in the result when it occupies no lines there.
 *
 * Both sides adding to a spot the base left empty makes a region zero rows
 * tall in the result: `resultRegionKinds` has no row to paint, and the pair
 * chunks the panes draw anchors from have the region filtered out. Without
 * this the middle pane shows nothing at all where the conflict is — the
 * connectors taper to a point and stop. IntelliJ draws a rule straight through
 * the result at the insertion point, which is what this feeds.
 */
export function resultRegionAnchors(
  regions: readonly ConflictRegion[],
): Array<{ line: number; kind: MergeLineKind }> {
  return regions
    .filter((region) => region.count === 0)
    .map((region) => ({
      line: region.start,
      kind: regionResolved(region)
        ? ("resolved" as const)
        : ("conflict" as const),
    }));
}

/**
 * Region colour for a flank pane, keyed by that flank's own lines and driven
 * by that flank's *own* state, never the region's. An ignored flank is still
 * takeable — its accept verb stands, IntelliJ keeps it in conflict colour —
 * so only a flank that actually landed (accepted), or a region the user
 * resolved by typing, goes quiet.
 */
export function flankRegionKinds(
  regions: readonly ConflictRegion[],
  flank: "ours" | "theirs",
): Map<number, MergeLineKind> {
  const kinds = new Map<number, MergeLineKind>();
  for (const region of regions) {
    const slice = flank === "ours" ? region.ours : region.theirs;
    const start = flank === "ours" ? region.oursStart : region.theirsStart;
    const state = flank === "ours" ? region.oursState : region.theirsState;
    const kind: MergeLineKind =
      state === "accepted" || region.edited ? "resolved" : "conflict";
    for (let i = 0; i < slice.length; i++) kinds.set(start + i, kind);
  }
  return kinds;
}

/**
 * The pair chunks the gutters draw connectors for and the panes draw
 * insertion anchors from — every non-equal chunk touching a conflict region,
 * on either side of the pair, is dropped, because `regionConnectors` draws a
 * region's polygon from its state and the raw diff's polygons and anchor
 * rules inside a region are noise. Rows are the exception: the panes render
 * them from the unfiltered chunks (the region kind maps repaint region rows
 * and suppress their intraline marks), and the axis, the folds and find use
 * the unfiltered lists too.
 *
 * A zero-count span is treated as a point touching the region inclusively at
 * both edges — that is what claims a flank-only add anchored on a zero-length
 * slot. On the flank side the test is strict body overlap only, so an edit's
 * chunk (flank span empty, anchored at a slice edge) keeps its connector and
 * anchor.
 */
export function renderableChunks(
  chunks: readonly DiffChunk[],
  regions: readonly ConflictRegion[],
  resultSide: "left" | "right",
  flank: "ours" | "theirs",
): DiffChunk[] {
  if (regions.length === 0) return [...chunks];
  return chunks.filter((chunk) => {
    if (chunk.kind === "equal") return true;
    const resultSpan = resultSide === "left" ? chunk.left : chunk.right;
    const flankSpan = resultSide === "left" ? chunk.right : chunk.left;
    for (const region of regions) {
      const slice = flank === "ours" ? region.ours : region.theirs;
      const sliceStart =
        flank === "ours" ? region.oursStart : region.theirsStart;
      const onResult =
        resultSpan.count === 0 || region.count === 0
          ? region.start <= resultSpan.start &&
            resultSpan.start <= region.start + region.count
          : resultSpan.start < region.start + region.count &&
            region.start < resultSpan.start + resultSpan.count;
      const onFlank =
        flankSpan.count > 0 &&
        slice.length > 0 &&
        flankSpan.start < sliceStart + slice.length &&
        sliceStart < flankSpan.start + flankSpan.count;
      if (onResult || onFlank) return false;
    }
    return true;
  });
}

/**
 * One connector polygon per region per flank, from region geometry alone —
 * never from the live diff, which shifts under decisions.
 *
 * The flank span is the slice's fixed home. The result span says where this
 * flank's content sits, or would land: a pending flank claims the whole
 * current range (accepting replaces it), an accepted one claims what landed,
 * and an ignored flank tapers to its exact insertion point — ours splices
 * above the landed theirs, theirs below the landed ours, the fixed
 * ours-then-theirs order — which is how "the other side is still takeable,
 * and it goes *here*" stays visible after a first accept.
 */
export interface RegionConnector {
  region: number;
  kind: MergeLineKind;
  flank: { start: number; count: number };
  result: { start: number; count: number };
}

export function regionConnectors(
  regions: readonly ConflictRegion[],
  flank: "ours" | "theirs",
): RegionConnector[] {
  return regions.map((region, index) => {
    const slice = flank === "ours" ? region.ours : region.theirs;
    const sliceStart = flank === "ours" ? region.oursStart : region.theirsStart;
    const state = flank === "ours" ? region.oursState : region.theirsState;
    const kind: MergeLineKind =
      state === "accepted" || region.edited ? "resolved" : "conflict";
    const result =
      state === "ignored" && !region.edited
        ? {
            start:
              flank === "ours" ? region.start : region.start + region.count,
            count: 0,
          }
        : { start: region.start, count: region.count };
    return {
      region: index,
      kind,
      flank: { start: sliceStart, count: slice.length },
      result,
    };
  });
}

/** Stripe marks in axis units: regions first, then plain changes. */
export function mergeStripeMarks(
  map: MergeAxisMap,
  regions: readonly ConflictRegion[],
  folds: MergeFolds,
): Array<{ start: number; span: number; kind: string }> {
  const marks: Array<{ start: number; span: number; kind: string }> = [];

  const regionSpans = regions.map((region) => {
    const startDisplay = displayLine(folds.pairO, region.start, "right");
    const start = paneToAxis(map, "result", startDisplay);
    const end =
      region.count > 0
        ? paneToAxis(
            map,
            "result",
            displayLine(folds.pairO, region.start + region.count - 1, "right") +
              1,
          )
        : start + regionGapSpan(map, startDisplay);
    return {
      start,
      span: Math.max(0.5, end - start),
      kind: regionResolved(region) ? "resolved" : "conflict",
    };
  });
  marks.push(...regionSpans);

  for (const segment of map.segments) {
    const changed =
      segment.result.span !== segment.ours.span ||
      segment.result.span !== segment.theirs.span ||
      segment.result.span === 0;
    if (!changed) continue;
    const overlapsRegion = regionSpans.some(
      (mark) =>
        mark.start < segment.axisStart + segment.axisSpan &&
        segment.axisStart < mark.start + mark.span,
    );
    if (overlapsRegion) continue;
    marks.push({
      start: segment.axisStart,
      span: Math.max(0.5, segment.axisSpan),
      kind: "modified",
    });
  }
  return marks;
}

/** How wide the gap standing in for a zero-length region is on the axis. */
function regionGapSpan(map: MergeAxisMap, resultDisplay: number): number {
  for (const segment of map.segments) {
    if (segment.result.span === 0 && segment.result.start === resultDisplay) {
      return segment.axisSpan;
    }
  }
  return 1;
}
