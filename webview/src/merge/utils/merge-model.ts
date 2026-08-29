import { diffArrays } from "diff";
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
  /** A committed edit island overlapped this region: typing is resolving. */
  edited: boolean;
}

export function regionResolved(region: ConflictRegion): boolean {
  return (
    region.edited ||
    (region.oursState !== "pending" && region.theirsState !== "pending")
  );
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
 * Conflicts with an empty base are refined by a 2-way diff between the sides,
 * because diff3 lumps everything into one region when there is no ancestor to
 * anchor on — runs the sides agree on are applied, only the genuine
 * disagreements stay conflicts. (The refinement deliberately does not run when
 * the base has content: those regions keep their base slice for the revert
 * path.)
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

    if (baseSlice.length > 0) {
      pushConflict(oursSlice, theirsSlice, baseSlice, oursAt, theirsAt);
      continue;
    }

    // Empty base: refine, so shared runs the sides agree on are not held
    // hostage by the disagreement next to them. Sub-anchors offset from the
    // region's own aStart/bStart as the 2-way walk consumes each side.
    let oursOffset = 0;
    let theirsOffset = 0;
    const changes = diffArrays(oursSlice, theirsSlice);
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change.added && !change.removed) {
        lines.push(...change.value);
        oursOffset += change.value.length;
        theirsOffset += change.value.length;
        continue;
      }
      if (change.removed) {
        const next = changes[i + 1];
        const theirsRun = next?.added ? next.value : [];
        pushConflict(
          change.value,
          theirsRun,
          [],
          oursAt + oursOffset,
          theirsAt + theirsOffset,
        );
        oursOffset += change.value.length;
        theirsOffset += theirsRun.length;
        if (next?.added) i++;
        continue;
      }
      // Added run with no preceding removal: theirs-only lines.
      pushConflict(
        [],
        change.value,
        [],
        oursAt + oursOffset,
        theirsAt + theirsOffset,
      );
      theirsOffset += change.value.length;
    }
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
    | { action: "revert" },
): MergeEdit {
  const region = regions[index];
  if (!region) return { buffer, regions: [...regions] };

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

/** Region colour for a flank pane, keyed by that flank's own lines. */
export function flankRegionKinds(
  regions: readonly ConflictRegion[],
  flank: "ours" | "theirs",
): Map<number, MergeLineKind> {
  const kinds = new Map<number, MergeLineKind>();
  for (const region of regions) {
    const slice = flank === "ours" ? region.ours : region.theirs;
    const start = flank === "ours" ? region.oursStart : region.theirsStart;
    const kind: MergeLineKind = regionResolved(region)
      ? "resolved"
      : "conflict";
    for (let i = 0; i < slice.length; i++) kinds.set(start + i, kind);
  }
  return kinds;
}

/**
 * Chunk indices whose connector should paint as conflict: every pair chunk
 * that overlaps a region's slice on the pane the pair addresses.
 */
export function regionChunkIndices(
  chunks: readonly DiffChunk[],
  regions: readonly ConflictRegion[],
  side: "left" | "right",
  flank: "ours" | "theirs",
): Set<number> {
  const indices = new Set<number>();
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.kind === "equal") continue;
    const span = side === "left" ? chunk.left : chunk.right;
    for (const region of regions) {
      const start = flank === "ours" ? region.oursStart : region.theirsStart;
      const length =
        flank === "ours" ? region.ours.length : region.theirs.length;
      const overlaps =
        span.start < start + Math.max(1, length) &&
        start < span.start + Math.max(1, span.count);
      if (overlaps) {
        indices.add(index);
        break;
      }
    }
  }
  return indices;
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
