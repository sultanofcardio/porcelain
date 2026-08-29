import { editableSide, useDiffStore } from "../../shared/store/diff-store";
import { chooseLayout } from "../utils/diff-model";

function Side({
  label,
  path,
  tag,
  editable = false,
  dirty = false,
}: {
  label: string;
  path: string;
  tag?: string;
  /** This side owns a buffer: the lock gives way to the pencil. */
  editable?: boolean;
  /** Unsaved edits — the dot every editor puts on a modified tab. */
  dirty?: boolean;
}) {
  return (
    <div>
      {editable ? (
        <span className="diff-editable" title="Editable" aria-hidden="true">
          ✎
        </span>
      ) : (
        <span className="diff-lock" title="Read-only">
          🔒
        </span>
      )}
      <span className="diff-hash">{label}</span>
      <span className="diff-path">{path}</span>
      {dirty && (
        <span
          className="diff-dirty"
          role="img"
          aria-label="Unsaved changes"
          title="Unsaved changes — Cmd+S saves"
        />
      )}
      {tag && <span className="diff-tag">{tag}</span>}
    </div>
  );
}

/**
 * What each side is, one per side.
 *
 * Labels come from the host rather than being derived here: it owns how content
 * is addressed, including the sentinels that stand for the index and the file
 * on disk, and the viewer has no reason to learn them. The side addressed as
 * the working tree is the one side that can be edited (the merge review's
 * decision 2), so it carries a pencil where every other side carries the lock.
 *
 * When the diff has collapsed to a single pane the header collapses with it —
 * a 50/50 header over one pane leaves half of itself labelling nothing. The
 * remaining side carries what happened to the file, which is the information
 * the absent revision would otherwise have given.
 */
export function RevisionHeader() {
  const { leftLabel, rightLabel, filePath, left, right, dirty } =
    useDiffStore();
  const leftRef = useDiffStore((s) => s.leftRef);
  const rightRef = useDiffStore((s) => s.rightRef);
  const layout = chooseLayout(left, right);
  const editable = editableSide({ leftRef, rightRef });

  if (layout.mode === "single") {
    const added = layout.side === "right";
    return (
      <div className="diff-revisions diff-revisions-single">
        <Side
          label={added ? rightLabel : leftLabel}
          path={filePath}
          tag={added ? "Added" : "Deleted"}
          editable={editable === layout.side}
          dirty={editable === layout.side && dirty}
        />
      </div>
    );
  }

  return (
    <div className="diff-revisions">
      <Side
        label={leftLabel}
        path={filePath}
        editable={editable === "left"}
        dirty={editable === "left" && dirty}
      />
      <Side
        label={rightLabel}
        path={filePath}
        editable={editable === "right"}
        dirty={editable === "right" && dirty}
      />
    </div>
  );
}
