import { LINE_HEIGHT } from "../../diff/components/metrics";
import { displayLine } from "../../diff/utils/diff-model";
import { Tooltip } from "../../shared/components/Tooltip";
import { paneFolds, useMergeStore } from "../../shared/store/merge-store";
import type { MergeFolds } from "../utils/merge-model";
import { regionResolved } from "../utils/merge-model";

interface MergeGutterVerbsProps {
  /** Which flank this gutter faces — decides the verbs and their glyphs. */
  flank: "ours" | "theirs";
  folds: MergeFolds;
  /** Display-row offset of the flank pane, for vertical anchoring. */
  flankOffset: number;
  /** Display-row offset of the result pane — the anchor for empty slices. */
  resultOffset: number;
  visibleLines: number;
}

/**
 * The verbs riding the conflict polygons: accept splices a flank's slice into
 * the result, ignore dismisses it, revert restores the base and both
 * pendings. They sit in the gutter at each region's first row — exactly where
 * the connector anchors — the way IntelliJ draws them.
 */
export function MergeGutterVerbs({
  flank,
  folds,
  flankOffset,
  resultOffset,
  visibleLines,
}: MergeGutterVerbsProps) {
  const regions = useMergeStore((s) => s.regions);
  const decideRegion = useMergeStore((s) => s.decideRegion);
  const openIslandForRegion = useMergeStore((s) => s.openIslandForRegion);
  const island = useMergeStore((s) => s.island);

  const pane = flank === "ours" ? "ours" : "theirs";
  const paneSide = flank === "ours" ? "left" : "right";
  const acceptGlyph = flank === "ours" ? "≫" : "≪";

  return (
    <>
      {regions.map((region, index) => {
        const slice = flank === "ours" ? region.ours : region.theirs;
        const sliceStart =
          flank === "ours" ? region.oursStart : region.theirsStart;
        // Anchor on the flank's own first region row; an empty slice anchors
        // on the result row the connector tapers to.
        const row =
          slice.length > 0
            ? displayLine(paneFolds(folds, pane), sliceStart, paneSide) -
              flankOffset
            : displayLine(folds.pairO, region.start, "right") - resultOffset;
        if (row < -1 || row > visibleLines + 1) return null;

        const resolved = regionResolved(region);
        const state = flank === "ours" ? region.oursState : region.theirsState;
        const ordinal = `conflict ${index + 1}`;

        return (
          <div
            key={index}
            className="merge-gutter-actions"
            style={{
              top: row * LINE_HEIGHT + 2,
              [flank === "ours" ? "left" : "right"]: 2,
            }}
          >
            {resolved ? (
              <>
                <Tooltip text="Revert this conflict to the base">
                  <button
                    type="button"
                    className="merge-verb merge-verb-revert"
                    aria-label={`Revert ${ordinal}`}
                    disabled={island !== null}
                    onClick={() => decideRegion(index, { action: "revert" })}
                  >
                    ↺
                  </button>
                </Tooltip>
                {/* Accept-both stays reachable, IntelliJ-style: a resolved
                    region keeps the accept verb for the flank not yet taken,
                    and clicking it adds that slice after the accepted one. */}
                {state !== "accepted" && slice.length > 0 && (
                  <Tooltip text={`Also accept ${flank} into the result`}>
                    <button
                      type="button"
                      className="merge-verb merge-verb-accept"
                      aria-label={`Accept ${flank} for ${ordinal}`}
                      disabled={island !== null}
                      onClick={() =>
                        decideRegion(index, { action: "accept", side: flank })
                      }
                    >
                      {acceptGlyph}
                    </button>
                  </Tooltip>
                )}
              </>
            ) : (
              <>
                <Tooltip text={`Accept ${flank} into the result`}>
                  <button
                    type="button"
                    className="merge-verb merge-verb-accept"
                    aria-label={`Accept ${flank} for ${ordinal}`}
                    disabled={island !== null || state === "accepted"}
                    onClick={() =>
                      decideRegion(index, { action: "accept", side: flank })
                    }
                  >
                    {acceptGlyph}
                  </button>
                </Tooltip>
                <Tooltip text={`Ignore the ${flank} side`}>
                  <button
                    type="button"
                    className="merge-verb merge-verb-ignore"
                    aria-label={`Ignore ${flank} for ${ordinal}`}
                    disabled={island !== null || state === "ignored"}
                    onClick={() =>
                      decideRegion(index, { action: "ignore", side: flank })
                    }
                  >
                    ✕
                  </button>
                </Tooltip>
                {flank === "ours" && (
                  <Tooltip text="Edit the result here by hand">
                    <button
                      type="button"
                      className="merge-verb"
                      aria-label={`Edit result for ${ordinal}`}
                      disabled={island !== null}
                      onClick={() => openIslandForRegion(index)}
                    >
                      ✎
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
