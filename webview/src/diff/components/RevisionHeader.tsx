import { useDiffStore } from "../../shared/store/diff-store";
import { chooseLayout } from "../utils/diff-model";

function Side({
  label,
  path,
  tag,
}: {
  label: string;
  path: string;
  tag?: string;
}) {
  return (
    <div>
      <span className="diff-lock" title="Read-only">
        🔒
      </span>
      <span className="diff-hash">{label}</span>
      <span className="diff-path">{path}</span>
      {tag && <span className="diff-tag">{tag}</span>}
    </div>
  );
}

/**
 * What each side is, one per side.
 *
 * Labels come from the host rather than being derived here: it owns how content
 * is addressed, including the sentinels that stand for the index and the file
 * on disk, and the viewer has no reason to learn them.
 *
 * When the diff has collapsed to a single pane the header collapses with it —
 * a 50/50 header over one pane leaves half of itself labelling nothing. The
 * remaining side carries what happened to the file, which is the information
 * the absent revision would otherwise have given.
 */
export function RevisionHeader() {
  const { leftLabel, rightLabel, filePath, left, right } = useDiffStore();
  const layout = chooseLayout(left, right);

  if (layout.mode === "single") {
    const added = layout.side === "right";
    return (
      <div className="diff-revisions diff-revisions-single">
        <Side
          label={added ? rightLabel : leftLabel}
          path={filePath}
          tag={added ? "Added" : "Deleted"}
        />
      </div>
    );
  }

  return (
    <div className="diff-revisions">
      <Side label={leftLabel} path={filePath} />
      <Side label={rightLabel} path={filePath} />
    </div>
  );
}
