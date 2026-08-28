import { useDiffStore } from "../../shared/store/diff-store";
import { chooseLayout } from "../utils/diff-model";

function shorten(ref: string): string {
  return /^[0-9a-f]{8,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

function Side({
  ref: revision,
  path,
  tag,
}: {
  ref: string;
  path: string;
  tag?: string;
}) {
  return (
    <div>
      <span className="diff-lock" title="Read-only">
        🔒
      </span>
      <span className="diff-hash">{shorten(revision)}</span>
      <span className="diff-path">{path}</span>
      {tag && <span className="diff-tag">{tag}</span>}
    </div>
  );
}

/**
 * Hash, path and a read-only marker, one per side.
 *
 * When the diff has collapsed to a single pane the header collapses with it:
 * a 50/50 header over one pane leaves half of itself labelling nothing. The
 * remaining side is tagged with what happened to the file, since that is the
 * information the absent revision would otherwise have carried.
 */
export function RevisionHeader() {
  const { leftRef, rightRef, filePath, left, right } = useDiffStore();
  const layout = chooseLayout(left, right);

  if (layout.mode === "single") {
    const added = layout.side === "right";
    return (
      <div className="diff-revisions diff-revisions-single">
        <Side
          ref={added ? rightRef : leftRef}
          path={filePath}
          tag={added ? "Added" : "Deleted"}
        />
      </div>
    );
  }

  return (
    <div className="diff-revisions">
      <Side ref={leftRef} path={filePath} />
      <Side ref={rightRef} path={filePath} />
    </div>
  );
}
