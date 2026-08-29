import { LINE_HEIGHT } from "../../diff/components/metrics";
import { displayLine } from "../../diff/utils/diff-model";
import { Tooltip } from "../../shared/components/Tooltip";
import { paneFolds, useMergeStore } from "../../shared/store/merge-store";
import type { MergeFolds } from "../utils/merge-model";

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
  const editRegionByHand = useMergeStore((s) => s.editRegionByHand);
  // Verbs sleep while an IME composition is live: a structural splice under
  // an in-flight composition would corrupt what the IME believes it owns.
  const composing = useMergeStore((s) => s.composition !== null);

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

        const state = flank === "ours" ? region.oursState : region.theirsState;
        const ordinal = `conflict ${index + 1}`;

        // Each flank's verbs follow that flank's own state, the IntelliJ
        // shape: an accepted side offers revert; an un-taken side keeps its
        // accept verb — clicking it splices that slice into the result
        // alongside what already landed — and a still-pending side keeps its
        // full set. Nothing here depends on whether the region as a whole
        // counts as resolved. Accept stays even for an empty slice: an
        // accepted empty flank is an accepted deletion, the one-click answer
        // to delete-vs-modify.
        return (
          <div
            key={index}
            className="merge-gutter-actions"
            style={{
              top: row * LINE_HEIGHT + 2,
              [flank === "ours" ? "left" : "right"]: 2,
            }}
          >
            {state !== "accepted" && (
              <Tooltip
                text={
                  state === "ignored"
                    ? `Also accept ${flank} into the result`
                    : `Accept ${flank} into the result`
                }
              >
                <button
                  type="button"
                  className="merge-verb merge-verb-accept"
                  aria-label={`Accept ${flank} for ${ordinal}`}
                  disabled={composing}
                  onClick={() =>
                    decideRegion(index, { action: "accept", side: flank })
                  }
                >
                  {acceptGlyph}
                </button>
              </Tooltip>
            )}
            {state === "pending" && (
              <Tooltip text={`Ignore the ${flank} side`}>
                <button
                  type="button"
                  className="merge-verb merge-verb-ignore"
                  aria-label={`Ignore ${flank} for ${ordinal}`}
                  disabled={composing}
                  onClick={() =>
                    decideRegion(index, { action: "ignore", side: flank })
                  }
                >
                  ✕
                </button>
              </Tooltip>
            )}
            {(state !== "pending" || region.edited) && (
              <Tooltip text="Revert this conflict to the base">
                <button
                  type="button"
                  className="merge-verb merge-verb-revert"
                  aria-label={`Revert ${ordinal}`}
                  disabled={composing}
                  onClick={() => decideRegion(index, { action: "revert" })}
                >
                  ↺
                </button>
              </Tooltip>
            )}
            {flank === "ours" && state === "pending" && !region.edited && (
              <Tooltip text="Edit the result here by hand">
                <button
                  type="button"
                  className="merge-verb"
                  aria-label={`Edit result for ${ordinal}`}
                  disabled={composing}
                  onClick={() => editRegionByHand(index)}
                >
                  ✎
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </>
  );
}
