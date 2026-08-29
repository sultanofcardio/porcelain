import {
  axisToSide,
  connectorPath,
  type DiffChunk,
  displayLine,
  displayLineCount,
  displayToSource,
  type FoldRegion,
} from "../utils/diff-model";
import {
  GUTTER_GAP_END,
  GUTTER_GAP_START,
  GUTTER_NUMBER_WIDTH,
  GUTTER_WIDTH,
  LINE_HEIGHT,
} from "./metrics";

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
}: DiffGutterProps) {
  const height = (visibleLines + 2) * LINE_HEIGHT;

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
        index,
        kind: chunk.kind,
        path: connectorPath(
          { ay0, ay1, by0, by1 },
          {
            width: GUTTER_WIDTH,
            gapStart: GUTTER_GAP_START,
            gapEnd: GUTTER_GAP_END,
            // Matches `.diff-anchor`, so the band leaves the gutter at exactly
            // the thickness the pane's marker continues at.
            minThickness: ANCHOR_THICKNESS,
          },
        ),
      },
    ];
  });

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

  if (only) {
    return (
      <div className="diff-gutter" style={{ width: GUTTER_NUMBER_WIDTH + 8 }}>
        <div className="diff-gutter-column" style={{ left: 0, right: 0 }}>
          {only === "left"
            ? numbers(leftOffset, leftLineCount, "right", "left")
            : numbers(rightOffset, rightLineCount, "right", "right")}
        </div>
      </div>
    );
  }

  return (
    <div className="diff-gutter" style={{ width: GUTTER_WIDTH }}>
      <svg
        className="diff-gutter-connectors"
        width={GUTTER_WIDTH}
        height={height}
        aria-hidden="true"
      >
        <title>Connections between changed regions</title>
        {connectors.map((connector) => (
          <path
            key={connector.index}
            d={connector.path}
            fill={FILL[connector.kind]}
          />
        ))}
      </svg>
      {/* Each column is pinned to its own edge, leaving the gap between them
          clear for the connectors to bend in. */}
      <div
        className="diff-gutter-column"
        style={{ left: 0, width: GUTTER_NUMBER_WIDTH }}
      >
        {numbers(leftOffset, leftLineCount, "right", "left")}
      </div>
      <div
        className="diff-gutter-column"
        style={{ right: 0, width: GUTTER_NUMBER_WIDTH }}
      >
        {numbers(rightOffset, rightLineCount, "left", "right")}
      </div>
    </div>
  );
}

export { axisToSide };
