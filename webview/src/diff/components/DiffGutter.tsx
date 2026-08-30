import { useMemo, useState } from "react";
import {
  axisToSide,
  connectorPath,
  type DiffChunk,
  displayLine,
  displayLineCount,
  displayToSource,
  type FoldRegion,
} from "../utils/diff-model";
import { gutterMetrics, LINE_HEIGHT } from "./metrics";

interface DiffGutterProps {
  chunks: DiffChunk[];
  /** Axis position at the top of the viewport. */
  axisPosition: number;
  visibleLines: number;
  leftOffset: number;
  rightOffset: number;
  leftLineCount: number;
  rightLineCount: number;
  /** The folds currently collapsed. */
  folds?: FoldRegion[];
  /**
   * Render only this side's numbers, with no connectors. Used when the diff
   * has collapsed to one pane: there is no second side to connect to.
   */
  only?: "left" | "right";
  /**
   * Connectors drawn from geometry the caller owns, on top of the chunk
   * connectors. The merge surface draws its conflict regions this way — from
   * region state, not from the live pair diff. Edges are viewport-relative
   * pixel ys, the same coordinate the chunk connectors are computed in:
   * `(displayRow - offset) * LINE_HEIGHT`.
   */
  /**
   * Per-change controls for a working-tree diff: a revert arrow and an
   * inclusion checkbox on each change, plus a checkbox on any line the
   * pointer is over so part of a block can be taken. Omitted, the gutter is
   * the read-only one every other surface uses.
   */
  changeControls?: {
    /** Whether every part of this change is already in the commit. */
    isChunkIncluded(chunk: DiffChunk): boolean;
    /** Whether one right-side line is already in the commit. */
    isLineIncluded(rightLine: number): boolean;
    /**
     * The whole chunk, not a line inside it: git merges changes closer than
     * its context width into one hunk, so a line only identifies the block
     * ambiguously and acting on the hunk would take its neighbours too.
     */
    onToggleChunk(chunk: DiffChunk, included: boolean): void;
    onToggleLine(rightLine: number): void;
    onRevert(chunk: DiffChunk): void;
  };
  extraConnectors?: Array<{
    key: string;
    ay0: number;
    ay1: number;
    by0: number;
    by1: number;
    fill: string;
  }>;
}

/*
 * Connectors are drawn as a flat fill with no outline. An outlined shape reads
 * as two different things — a bright edge and a dim interior — when it is one
 * region; the eye follows the edge instead of the band.
 */
const FILL: Record<string, string> = {
  modified: "var(--diff-modified-connector)",
  added: "var(--diff-added-connector)",
  removed: "var(--diff-removed-connector)",
};

/**
 * The floor on connector thickness, matching `.diff-anchor` in the stylesheet
 * so the band and the pane's insertion marker are the same weight where they
 * meet.
 */
const ANCHOR_THICKNESS = 2;

/**
 * The centre gutter: each side's own line numbers, with the connectors drawn
 * behind them.
 *
 * The numbers are two independent columns rather than one aligned pair,
 * because the panes drift — past an unequal chunk the same screen row shows
 * different line numbers on each side, and that divergence is the point.
 */
export function DiffGutter({
  chunks,
  visibleLines,
  leftOffset,
  rightOffset,
  leftLineCount,
  rightLineCount,
  folds = [],
  only,
  changeControls,
  extraConnectors = [],
}: DiffGutterProps) {
  const height = (visibleLines + 2) * LINE_HEIGHT;
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  // The right-side lines that belong to a change: only those can be taken or
  // left behind line by line.
  const changedRightLines = useMemo(() => {
    const lines = new Set<number>();
    if (!changeControls) return lines;
    for (const chunk of chunks) {
      if (chunk.kind === "equal") continue;
      for (let i = 0; i < chunk.right.count; i++) {
        lines.add(chunk.right.start + i);
      }
    }
    return lines;
  }, [chunks, changeControls]);

  // Sized from the larger side's line count, so a five-digit file widens the
  // columns instead of crowding them. The connectors' bend stays confined to
  // the gap because the gap moves with the columns.
  const metrics = gutterMetrics(Math.max(leftLineCount, rightLineCount));

  // Offsets and edges are display rows; with no folds that is source lines,
  // and the arithmetic is unchanged. Connector edges sit on non-equal chunk
  // boundaries, which folds never hide — but the folds *above* an edge shift
  // where it renders, and `displayLine` carries that shift.
  const y = (line: number, offset: number, side: "left" | "right") =>
    (displayLine(folds, line, side) - offset) * LINE_HEIGHT;

  const connectors = chunks.flatMap((chunk, index) => {
    if (chunk.kind === "equal") return [];
    const ay0 = y(chunk.left.start, leftOffset, "left");
    const ay1 = y(chunk.left.start + chunk.left.count, leftOffset, "left");
    const by0 = y(chunk.right.start, rightOffset, "right");
    const by1 = y(chunk.right.start + chunk.right.count, rightOffset, "right");

    // Skip anything comfortably off-screen; a connector can be tall, so the
    // margin is generous rather than exact.
    const top = Math.min(ay0, by0);
    const bottom = Math.max(ay1, by1);
    if (bottom < -height || top > height * 2) return [];

    return [
      {
        key: `chunk-${index}`,
        fill: FILL[chunk.kind],
        path: connectorPath(
          { ay0, ay1, by0, by1 },
          {
            width: metrics.width,
            gapStart: metrics.gapStart,
            gapEnd: metrics.gapEnd,
            // Matches `.diff-anchor`, so the band leaves the gutter at exactly
            // the thickness the pane's marker continues at.
            minThickness: ANCHOR_THICKNESS,
          },
        ),
      },
    ];
  });

  for (const extra of extraConnectors) {
    const top = Math.min(extra.ay0, extra.by0);
    const bottom = Math.max(extra.ay1, extra.by1);
    if (bottom < -height || top > height * 2) continue;
    connectors.push({
      key: `extra-${extra.key}`,
      fill: extra.fill,
      path: connectorPath(
        { ay0: extra.ay0, ay1: extra.ay1, by0: extra.by0, by1: extra.by1 },
        {
          width: metrics.width,
          gapStart: metrics.gapStart,
          gapEnd: metrics.gapEnd,
          minThickness: ANCHOR_THICKNESS,
        },
      ),
    });
  }

  const numbers = (
    offset: number,
    total: number,
    align: "right" | "left",
    side: "left" | "right",
  ) => {
    const first = Math.max(0, Math.floor(offset));
    const displayTotal = displayLineCount(total, folds);
    const rows = [];
    for (
      let row = first;
      row < Math.min(displayTotal, first + visibleLines + 2);
      row++
    ) {
      const source = displayToSource(folds, row, side);
      // A fold row gets no number: it stands for a run of them, and any one
      // number would be a lie about the rest.
      if (source.kind === "fold") continue;
      rows.push(
        <div
          key={row}
          className="diff-gutter-number"
          style={{
            top: (row - offset) * LINE_HEIGHT,
            textAlign: align,
          }}
        >
          {source.line + 1}
        </div>,
      );
    }
    return rows;
  };

  // One control cluster per change, anchored on the change's first row on the
  // right — the side a working-tree diff edits.
  const controls = changeControls
    ? chunks.flatMap((chunk) => {
        if (chunk.kind === "equal") return [];
        const onRight = chunk.right.count > 0;
        // Only where the cluster is *drawn* falls back to the left side: a
        // pure deletion has no row of its own on the right. What it acts on
        // is the chunk, whose extent covers both sides, so a deletion past
        // the last line needs no special case — its range covers the row the
        // removals sit in front of, even when that row is the end of file.
        const row = onRight
          ? y(chunk.right.start, rightOffset, "right")
          : y(chunk.left.start, leftOffset, "left");
        if (row < -LINE_HEIGHT || row > height) return [];
        return [
          {
            key: `control-${chunk.left.start}-${chunk.right.start}`,
            chunk,
            // Labels read from the right where there is one, the left where
            // there is not, so a deletion names a line the reader can see.
            label: (onRight ? chunk.right.start : chunk.left.start) + 1,
            row,
            included: changeControls.isChunkIncluded(chunk),
            // The rows this cluster's own checkbox already speaks for.
            covered: onRight ? chunk.right.start : -1,
          },
        ];
      })
    : [];

  if (only) {
    return (
      <div className="diff-gutter" style={{ width: metrics.numberWidth + 8 }}>
        <div className="diff-gutter-column" style={{ left: 0, right: 0 }}>
          {only === "left"
            ? numbers(leftOffset, leftLineCount, "right", "left")
            : numbers(rightOffset, rightLineCount, "right", "right")}
        </div>
      </div>
    );
  }

  return (
    <div
      className="diff-gutter"
      style={{ width: metrics.width }}
      onMouseMove={
        changeControls
          ? (event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const displayRow = Math.floor(
                (event.clientY - bounds.top) / LINE_HEIGHT + rightOffset,
              );
              // The pointer offset is a display row; a fold above it shifts it
              // off the source line. Convert to a source line once, here, so
              // `hoveredLine` is a source line end to end (the renderer maps it
              // back with `y`). Only lines inside a change can be toggled.
              const source = displayToSource(folds, displayRow, "right");
              const line = source.kind === "line" ? source.line : null;
              setHoveredLine(
                line !== null && changedRightLines.has(line) ? line : null,
              );
            }
          : undefined
      }
      onMouseLeave={changeControls ? () => setHoveredLine(null) : undefined}
    >
      <svg
        className="diff-gutter-connectors"
        width={metrics.width}
        height={height}
        aria-hidden="true"
      >
        {connectors.map((connector) => (
          <path key={connector.key} d={connector.path} fill={connector.fill} />
        ))}
      </svg>
      {/* Each column is pinned to its own edge, leaving the gap between them
          clear for the connectors to bend in. */}
      <div
        className="diff-gutter-column"
        style={{ left: 0, width: metrics.numberWidth }}
      >
        {numbers(leftOffset, leftLineCount, "right", "left")}
      </div>
      <div
        className="diff-gutter-column"
        style={{ right: 0, width: metrics.numberWidth }}
      >
        {numbers(rightOffset, rightLineCount, "left", "right")}
      </div>
      {changeControls &&
        controls.map((control) => (
          <div
            key={control.key}
            className="diff-change-controls"
            style={{ top: control.row }}
          >
            <button
              type="button"
              className="diff-change-revert"
              aria-label={`Revert change at line ${control.label}`}
              title="Revert this change"
              onClick={() => changeControls.onRevert(control.chunk)}
            >
              ≫
            </button>
            <input
              type="checkbox"
              className="diff-change-include"
              aria-label={`Include change at line ${control.label} in the commit`}
              checked={control.included}
              onChange={() =>
                changeControls.onToggleChunk(control.chunk, control.included)
              }
            />
          </div>
        ))}
      {/* The first row of a change already carries the block's own checkbox;
          a second one stacked on top of it would be two controls for one row
          saying different things. */}
      {changeControls &&
        hoveredLine !== null &&
        !controls.some((control) => control.covered === hoveredLine) && (
          <div
            className="diff-line-control"
            style={{ top: y(hoveredLine, rightOffset, "right") }}
          >
            <input
              type="checkbox"
              aria-label={`Include line ${hoveredLine + 1} in the commit`}
              checked={changeControls.isLineIncluded(hoveredLine)}
              onChange={() => changeControls.onToggleLine(hoveredLine)}
            />
          </div>
        )}
    </div>
  );
}

export { axisToSide };
