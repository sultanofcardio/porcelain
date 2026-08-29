import { useState } from "react";
import type { DiffFallbackInfo } from "../../shared/store/diff-store";
import { useDiffStore } from "../../shared/store/diff-store";

interface DiffFallbackProps {
  fallback: DiffFallbackInfo;
  onOpenInEditor: () => void;
  /** Re-request the diff with the size limit waived. */
  onShowAnyway: () => void;
}

/** "12.4 KB", or "empty" for an absent side. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "empty";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * What stands in for the panes when the host says the content is not
 * line-diffable. The shell around it — toolbar, revision headers, file
 * steppers — stays up, because stepping to the next file has to keep working
 * from a binary one.
 */
export function DiffFallback({
  fallback,
  onOpenInEditor,
  onShowAnyway,
}: DiffFallbackProps) {
  // Local only: the whole placeholder unmounts when the forced content lands.
  const [waiting, setWaiting] = useState(false);
  const { leftLabel, rightLabel } = useDiffStore();

  if (fallback.kind === "image") {
    return (
      <div className="diff-fallback diff-fallback-images">
        <ImageSide
          label={leftLabel}
          uri={fallback.leftUri}
          bytes={fallback.leftBytes}
        />
        <ImageSide
          label={rightLabel}
          uri={fallback.rightUri}
          bytes={fallback.rightBytes}
        />
      </div>
    );
  }

  if (fallback.kind === "binary") {
    return (
      <div className="diff-fallback">
        <div className="diff-fallback-title">
          Binary file — no text diff to show
        </div>
        <div className="diff-fallback-detail">
          {formatBytes(fallback.leftBytes)} → {formatBytes(fallback.rightBytes)}
          {" · "}
          {fallback.differs ? "differs" : "identical"}
        </div>
        <div className="diff-fallback-actions">
          <button
            type="button"
            className="diff-fallback-btn diff-fallback-btn-primary"
            onClick={onOpenInEditor}
          >
            Open in editor
          </button>
        </div>
      </div>
    );
  }

  if (fallback.kind === "tooLarge") {
    return (
      <div className="diff-fallback">
        <div className="diff-fallback-title">
          Large file — {fallback.lines.toLocaleString()} lines
        </div>
        <div className="diff-fallback-detail">
          Diffing past {fallback.limit.toLocaleString()} lines can take seconds,
          so it waits to be asked.
        </div>
        <div className="diff-fallback-actions">
          <button
            type="button"
            className="diff-fallback-btn diff-fallback-btn-primary"
            disabled={waiting}
            onClick={() => {
              setWaiting(true);
              onShowAnyway();
            }}
          >
            {waiting ? "Computing…" : "Show anyway"}
          </button>
          <button
            type="button"
            className="diff-fallback-btn"
            onClick={onOpenInEditor}
          >
            Open in editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-fallback">
      <div className="diff-fallback-title">Could not read this diff</div>
      <div className="diff-fallback-detail">{fallback.reason}</div>
      <div className="diff-fallback-actions">
        <button
          type="button"
          className="diff-fallback-btn diff-fallback-btn-primary"
          onClick={onOpenInEditor}
        >
          Open in editor
        </button>
      </div>
    </div>
  );
}

/**
 * One side of an image diff. The absent side keeps its column — unlike a text
 * diff, an added image is most useful next to the empty space it replaced,
 * and a single centred image reads as a preview rather than a comparison.
 */
function ImageSide({
  label,
  uri,
  bytes,
}: {
  label: string;
  uri?: string;
  bytes: number;
}) {
  return (
    <figure className="diff-image-side">
      {uri ? (
        <img src={uri} alt={`${label} version`} />
      ) : (
        <div className="diff-image-absent">No image in {label}</div>
      )}
      <figcaption>{formatBytes(bytes)}</figcaption>
    </figure>
  );
}
