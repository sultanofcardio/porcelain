import { useEffect, useState } from "react";
import { CommitInfo } from "../../shared/components/CommitInfo";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { Commit } from "../../shared/types/git";

const COLLAPSED_BRANCH_COUNT = 6;

export function CommitDetail() {
  const commits = useGitLogStore((s) => s.commits);
  const selectedCommitHashes = useGitLogStore((s) => s.selectedCommitHashes);

  const selectedCommits = selectedCommitHashes
    .map((h) => commits.find((c) => c.hash === h))
    .filter((c): c is Commit => c != null);

  if (selectedCommits.length === 0) {
    return (
      <div style={{ padding: 12, opacity: 0.5 }}>
        Select a commit to view details
      </div>
    );
  }

  return (
    <div style={{ padding: 12, overflow: "auto", overflowX: "hidden" }}>
      {selectedCommits.map((commit, i) => (
        <div key={commit.hash}>
          {i > 0 && (
            <hr
              style={{
                border: "none",
                borderTop: "1px solid var(--border)",
                margin: "10px 0",
              }}
            />
          )}
          <CommitInfo commit={commit} />
        </div>
      ))}
      {selectedCommits.length === 1 && (
        <ContainingBranches hash={selectedCommits[0].hash} />
      )}
    </div>
  );
}

/**
 * "In N branches" line for a single selected commit, loaded lazily: the
 * containment query walks history per branch and must not block row selection.
 */
function ContainingBranches({ hash }: { hash: string }) {
  const requestFromSurface = useGitLogStore((s) => s.requestFromSurface);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBranches(null);
    setExpanded(false);
    void (async () => {
      try {
        const result = (await requestFromSurface("getContainingBranches", {
          hash,
        })) as { local: string[]; remote: string[] } | null;
        if (!cancelled && result) {
          setBranches([...result.local, ...result.remote]);
        }
      } catch (err) {
        console.error("getContainingBranches failed:", err);
        if (!cancelled) setBranches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hash, requestFromSurface]);

  if (branches === null) {
    return (
      <div style={{ marginTop: 10, fontSize: "12px", opacity: 0.5 }}>
        In branches: loading…
      </div>
    );
  }
  if (branches.length === 0) {
    return (
      <div style={{ marginTop: 10, fontSize: "12px", opacity: 0.5 }}>
        Not in any branch
      </div>
    );
  }

  const shown = expanded ? branches : branches.slice(0, COLLAPSED_BRANCH_COUNT);
  const hiddenCount = branches.length - shown.length;

  return (
    <div style={{ marginTop: 10, fontSize: "12px" }}>
      <span style={{ opacity: 0.6 }}>
        In {branches.length} {branches.length === 1 ? "branch" : "branches"}:{" "}
      </span>
      <span style={{ wordBreak: "break-word" }}>{shown.join(", ")}</span>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={linkButtonStyle}
        >
          Show all
        </button>
      )}
      {expanded && branches.length > COLLAPSED_BRANCH_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={linkButtonStyle}
        >
          Hide
        </button>
      )}
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--vscode-textLink-foreground, #3794ff)",
  cursor: "pointer",
  fontSize: "12px",
};
