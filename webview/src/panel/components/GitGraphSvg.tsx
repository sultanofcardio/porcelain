import { type Ref, useMemo, useState } from "react";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { LaneInfo } from "../../shared/types/git";
import { computeCollapsibleSequences } from "../../shared/utils/collapsible-sequences";

const COLUMN_WIDTH = 10;
const ROW_HEIGHT = 28;
const GRAPH_PADDING = 6;
const VISIBLE_OVERSCAN = 8;
/** Edges spanning more rows than this collapse into clickable arrow stubs. */
const LONG_EDGE_ROWS = 30;
const LONG_EDGE_PX = LONG_EDGE_ROWS * ROW_HEIGHT;
const LANE_COLORS = [
  "#3a8ee6", // blue – primary branch (IDEA blue)
  "#c75450", // red – merge/feature branch
  "#59a869", // green – secondary branch
  "#e5c07b", // golden yellow
  "#b07cd8", // purple/violet
  "#2aa198", // teal/cyan
  "#d19a66", // warm orange
  "#56b6c2", // light teal
];

function laneColor(colorIdx: number): string {
  return LANE_COLORS[colorIdx % LANE_COLORS.length];
}

function colX(col: number): number {
  return GRAPH_PADDING + col * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

function rowY(row: number): number {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function linePath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  isStub?: boolean,
): string {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  if (isStub) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  // IDEA-style: vertical → diagonal (one row height) → vertical
  // The diagonal segment spans one ROW_HEIGHT vertically while shifting columns.
  const diagonalH = ROW_HEIGHT; // vertical extent of the diagonal segment
  const totalDeltaY = toY - fromY;

  if (totalDeltaY <= diagonalH) {
    // Not enough vertical space for full pattern – just draw a straight diagonal
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  if (toX > fromX) {
    // Branching out (rightward): diagonal starts at the top (near source)
    const diagEndY = fromY + diagonalH;
    return `M ${fromX} ${fromY} L ${toX} ${diagEndY} L ${toX} ${toY}`;
  }
  // Merging in (leftward): diagonal ends at the bottom (near target)
  const diagStartY = toY - diagonalH;
  return `M ${fromX} ${fromY} L ${fromX} ${diagStartY} L ${toX} ${toY}`;
}

/**
 * Walk the graph layout's parent chain from `hash` until we find a commit
 * that exists in the visible set, skipping hidden (filtered-out) commits.
 */
function resolveVisibleTarget(
  hash: string,
  visibleSet: Set<string>,
  layout: Record<string, LaneInfo>,
): string | null {
  let current = hash;
  const visited = new Set<string>();
  while (current && !visibleSet.has(current)) {
    if (visited.has(current)) return null;
    visited.add(current);
    const lane = layout[current];
    if (!lane || lane.lines.length === 0) return null;
    current = lane.lines[0].toCommit;
  }
  return visibleSet.has(current) ? current : null;
}

// ── Component ──────────────────────────────────────────────────────

export function GitGraphSvg({
  scrollGroupRef,
  scrollTop,
  height,
  topOffset = 0,
  leftOffset = 0,
}: {
  scrollGroupRef?: Ref<SVGGElement>;
  scrollTop: number;
  height: number;
  topOffset?: number;
  /** Horizontal start of the graph strip, past any column that precedes it. */
  leftOffset?: number;
}) {
  const visibleCommits = useGitLogStore((s) => s.visibleCommits);
  const commits = useGitLogStore((s) => s.commits);
  const graphLayout = useGitLogStore((s) => s.graphLayout);
  const collapsedSequenceIds = useGitLogStore((s) => s.collapsedSequenceIds);
  const toggleSequenceCollapse = useGitLogStore(
    (s) => s.toggleSequenceCollapse,
  );
  const showLongEdges = useGitLogStore((s) => s.presentation.showLongEdges);
  const jumpToCommit = useGitLogStore((s) => s.jumpToCommit);

  const [hoveredSequenceId, setHoveredSequenceId] = useState<string | null>(
    null,
  );

  const maxColumn = Math.max(
    0,
    ...Object.values(graphLayout).map((l) => l.column),
  );
  const svgWidth = (maxColumn + 1) * COLUMN_WIDTH + GRAPH_PADDING * 2;

  // Sequence detection on full commits list
  const { hashToSequenceId, sequencesById } = useMemo(
    () => computeCollapsibleSequences(commits, graphLayout),
    [commits, graphLayout],
  );

  const { rowIndexByHash, visibleSet } = useMemo(() => {
    const indexMap: Record<string, number> = {};
    const set = new Set<string>();
    for (let i = 0; i < visibleCommits.length; i++) {
      indexMap[visibleCommits[i].hash] = i;
      set.add(visibleCommits[i].hash);
    }
    return { rowIndexByHash: indexMap, visibleSet: set };
  }, [visibleCommits]);

  const { allLines, allNodes } = useMemo(() => {
    const lines: Array<{
      key: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      minY: number;
      maxY: number;
      color: string;
      isStub?: boolean;
      isDashed?: boolean;
      fromHash?: string;
      targetHash?: string;
      sequenceId?: string;
      arrow?: "up" | "down";
      /** Set on long-edge stubs: clicking jumps to this loaded commit. */
      jumpToHash?: string;
    }> = [];
    const nodes: Array<{
      key: string;
      cx: number;
      cy: number;
      color: string;
      isMerge: boolean;
      isHead: boolean;
    }> = [];

    if (!visibleCommits.length) {
      return { allLines: lines, allNodes: nodes };
    }

    for (let i = 0; i < visibleCommits.length; i++) {
      const commit = visibleCommits[i];
      const lane = graphLayout[commit.hash];
      if (!lane) continue;

      const fromX = colX(lane.column);
      const fromY = rowY(i);
      const color = laneColor(lane.color);

      nodes.push({
        key: commit.hash,
        cx: fromX,
        cy: fromY,
        color,
        isMerge: commit.parents.length > 1,
        isHead: commit.refs.some((r) => r.type === "HEAD"),
      });

      for (const line of lane.lines) {
        let targetHash = line.toCommit;
        let targetIdx = rowIndexByHash[targetHash];
        const isStraight = lane.column === line.toColumn;
        let isStub = false;
        let wasResolved = false;

        if (targetIdx == null) {
          if (isStraight) {
            const resolved = resolveVisibleTarget(
              targetHash,
              visibleSet,
              graphLayout,
            );
            if (!resolved) {
              // Target not in visible set at all — draw a stub downward
              isStub = true;
            } else {
              if (resolved !== targetHash) wasResolved = true;
              targetHash = resolved;
              targetIdx = rowIndexByHash[targetHash];
              if (targetIdx == null) {
                isStub = true;
              }
            }
          } else {
            isStub = true;
          }
        }

        const targetLane = graphLayout[targetHash];
        let toX: number;
        if (targetLane) {
          toX = colX(targetLane.column);
        } else if (line.hiddenParent) {
          const origTargetLane = graphLayout[line.toCommit];
          toX = origTargetLane
            ? colX(origTargetLane.column)
            : colX(line.toColumn);
        } else {
          toX = colX(line.toColumn);
        }

        let toY: number;
        let isDashed = false;

        if (isStub) {
          toY = fromY + ROW_HEIGHT;
          if (!isStraight) {
            const dx = toX - fromX;
            toX =
              fromX +
              Math.sign(dx) * Math.min(Math.abs(dx), COLUMN_WIDTH * 0.5);
          } else {
            toX = fromX;
          }
          isDashed = false;
        } else {
          toY = rowY(targetIdx as number);
          if (wasResolved) {
            isDashed = true;
          }
          // IntelliJ hides edges longer than ~30 rows behind a pair of arrow
          // stubs; clicking either stub jumps to the edge's other end. Both
          // endpoints are loaded rows here, so the jump is always resolvable.
          if (!showLongEdges && toY - fromY > LONG_EDGE_PX) {
            const dx = toX - fromX;
            const stubX =
              dx === 0
                ? fromX
                : fromX +
                  Math.sign(dx) * Math.min(Math.abs(dx), COLUMN_WIDTH * 0.5);
            lines.push({
              key: `${commit.hash}-${targetHash}-stub-down`,
              fromX,
              fromY,
              toX: stubX,
              toY: fromY + ROW_HEIGHT,
              minY: fromY,
              maxY: fromY + ROW_HEIGHT,
              color,
              isStub: true,
              arrow: "down",
              jumpToHash: targetHash,
              fromHash: commit.hash,
              targetHash: line.toCommit,
            });
            lines.push({
              key: `${commit.hash}-${targetHash}-stub-up`,
              fromX: toX,
              fromY: toY,
              toX,
              toY: toY - ROW_HEIGHT,
              minY: toY - ROW_HEIGHT,
              maxY: toY,
              color,
              isStub: true,
              arrow: "up",
              jumpToHash: commit.hash,
              fromHash: commit.hash,
              targetHash: line.toCommit,
            });
            continue;
          }
        }

        // Determine sequenceId for this line
        let lineSeqId: string | undefined;
        // If fromHash is in a sequence → this line belongs to that sequence
        const fromSeq = hashToSequenceId[commit.hash];
        if (fromSeq) {
          lineSeqId = fromSeq;
        } else {
          // If fromHash is the headHash of a sequence and target is the first intermediate
          const origTarget = line.toCommit;
          const targetSeq = hashToSequenceId[origTarget];
          if (targetSeq && isStraight) {
            const seq = sequencesById[targetSeq];
            if (seq && seq.headHash === commit.hash) {
              lineSeqId = targetSeq;
            }
          }
        }
        lines.push({
          key: `${commit.hash}-${targetHash}-${lane.column}-${line.toColumn}`,
          fromX,
          fromY,
          toX,
          toY,
          minY: Math.min(fromY, toY),
          maxY: Math.max(fromY, toY),
          color,
          isStub,
          isDashed,
          arrow: isStub ? "down" : undefined,
          fromHash: commit.hash,
          targetHash: line.toCommit,
          sequenceId: lineSeqId,
        });
      }
    }

    return { allLines: lines, allNodes: nodes };
  }, [
    visibleCommits,
    graphLayout,
    rowIndexByHash,
    visibleSet,
    hashToSequenceId,
    sequencesById,
    showLongEdges,
  ]);

  const { visibleLines, visibleNodes } = useMemo(() => {
    const overscanPx = VISIBLE_OVERSCAN * ROW_HEIGHT;
    const viewportTop = scrollTop - overscanPx;
    const viewportBottom = scrollTop + height + overscanPx;

    const lines = allLines
      .filter((line) => line.maxY >= viewportTop && line.minY <= viewportBottom)
      .map((line) => ({
        key: line.key,
        d: linePath(line.fromX, line.fromY, line.toX, line.toY, line.isStub),
        color: line.color,
        isStub: line.isStub,
        isDashed: line.isDashed,
        arrow: line.arrow,
        jumpToHash: line.jumpToHash,
        fromHash: line.fromHash,
        targetHash: line.targetHash,
        sequenceId: line.sequenceId,
        toX: line.toX,
        toY: line.toY,
      }));

    const nodes = allNodes.filter(
      (node) => node.cy >= viewportTop && node.cy <= viewportBottom,
    );

    return { visibleLines: lines, visibleNodes: nodes };
  }, [allLines, allNodes, height, scrollTop]);

  return (
    <svg
      width={svgWidth}
      height={height}
      viewBox={`0 0 ${svgWidth} ${height}`}
      style={{
        position: "absolute",
        top: topOffset,
        left: leftOffset,
        pointerEvents: "none",
        zIndex: 2,
      }}
      aria-hidden="true"
    >
      <g ref={scrollGroupRef} transform={`translate(0, ${-scrollTop})`}>
        {visibleLines.map((line) => {
          const hasSeq = !!line.sequenceId;
          const isJumpStub = !!line.jumpToHash;
          const interactive = hasSeq || isJumpStub;
          const isSeqHovered = hasSeq && line.sequenceId === hoveredSequenceId;
          const isSeqCollapsed =
            hasSeq && collapsedSequenceIds.has(line.sequenceId as string);

          let className = "graph-line-group";
          if (hasSeq) {
            className += " graph-sequence-line interactive";
            if (isSeqHovered) className += " sequence-hover";
            if (isSeqCollapsed) className += " sequence-collapsed";
          }
          if (isJumpStub) className += " graph-jump-stub interactive";

          return (
            <g
              key={line.key}
              className={className}
              style={{
                cursor: interactive ? "pointer" : "default",
                pointerEvents: interactive ? "auto" : "none",
              }}
              onMouseEnter={() => {
                if (hasSeq) setHoveredSequenceId(line.sequenceId as string);
              }}
              onMouseLeave={() => {
                if (hasSeq) setHoveredSequenceId(null);
              }}
              onClick={() => {
                if (line.jumpToHash) {
                  jumpToCommit(line.jumpToHash);
                  return;
                }
                if (line.sequenceId) {
                  const seq = sequencesById[line.sequenceId];
                  if (seq) {
                    toggleSequenceCollapse(seq.id, seq.intermediates);
                  }
                }
              }}
            >
              {isJumpStub && (
                <title>{`Jump to ${line.jumpToHash?.slice(0, 8)}`}</title>
              )}
              <path
                className="graph-line-path"
                d={line.d}
                fill="none"
                stroke={line.color}
                strokeWidth={1.2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={
                  line.isDashed && !line.isStub ? "4,2" : undefined
                }
                opacity={1}
              />
              {line.arrow === "down" && (
                <polygon
                  points={`${line.toX - 2.5},${line.toY - 4} ${line.toX},${line.toY} ${line.toX + 2.5},${line.toY - 4}`}
                  fill={line.color}
                />
              )}
              {line.arrow === "up" && (
                <polygon
                  points={`${line.toX - 2.5},${line.toY + 4} ${line.toX},${line.toY} ${line.toX + 2.5},${line.toY + 4}`}
                  fill={line.color}
                />
              )}
              <path
                className="graph-line-hitbox"
                d={line.d}
                fill="none"
                stroke="transparent"
                strokeWidth={interactive ? 12 : 0}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {visibleNodes.map((node) => (
          <g key={node.key}>
            {node.isMerge ? (
              <>
                <circle cx={node.cx} cy={node.cy} r={3.5} fill={node.color} />
                <circle
                  cx={node.cx}
                  cy={node.cy}
                  r={2}
                  fill="var(--app-bg, #1e1e1e)"
                />
                <circle cx={node.cx} cy={node.cy} r={1.2} fill={node.color} />
              </>
            ) : (
              <circle cx={node.cx} cy={node.cy} r={2.8} fill={node.color} />
            )}

            {node.isHead && (
              <circle
                cx={node.cx}
                cy={node.cy}
                r={5}
                fill="none"
                stroke={node.color}
                strokeWidth={1}
                opacity={0.22}
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}
