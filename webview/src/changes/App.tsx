import { useCallback, useEffect, useMemo, useState } from "react";
import CodiconListFlat from "~icons/codicon/list-flat";
import CodiconListTree from "~icons/codicon/list-tree";
import { bridge } from "../shared/bridge";
import { FileTree } from "../shared/components/FileTree";
import type { DiffFile } from "../shared/types/git";
import "./changes.css";

interface ChangesSeed {
  repoId: string | null;
  fromHash: string | null;
  toHash: string | null;
}

function readSeed(): ChangesSeed {
  const dataset = document.getElementById("root")?.dataset ?? {};
  return {
    repoId: dataset.repoId?.trim() || null,
    fromHash: dataset.fromHash?.trim() || null,
    toHash: dataset.toHash?.trim() || null,
  };
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; files: DiffFile[] };

export function ChangesApp() {
  const seed = useMemo(readSeed, []);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const { repoId, fromHash, toHash } = seed;

  useEffect(() => {
    if (!repoId || !fromHash || !toHash) return;
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const files = (await bridge.request(
          "getComparisonFiles",
          { fromHash, toHash },
          { repoId },
        )) as DiffFile[] | null;
        if (cancelled) return;
        setState({ kind: "ready", files: Array.isArray(files) ? files : [] });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [repoId, fromHash, toHash]);

  const files = state.kind === "ready" ? state.files : [];
  const openDiff = useCallback(
    (file: DiffFile) => {
      if (!repoId || !fromHash || !toHash) return;
      // `baseRef` makes the host diff the two comparison endpoints instead of
      // the commit against its parent; `fileList` feeds next/prev navigation.
      void bridge.request(
        "openDiffEditor",
        { commit: toHash, baseRef: fromHash, file, fileList: files },
        { repoId },
      );
    },
    [repoId, fromHash, toHash, files],
  );

  if (!repoId || !fromHash || !toHash) {
    return (
      <div
        className="changes-state"
        data-testid="changes-state"
        data-state="unavailable"
      >
        Comparison unavailable.
      </div>
    );
  }

  const fileCount = state.kind === "ready" ? state.files.length : 0;

  return (
    <div className="changes-container">
      <header className="changes-header">
        <span className="changes-title">
          Changes Between <code>{shortHash(fromHash)}</code> and{" "}
          <code>{shortHash(toHash)}</code>
        </span>
        <span className="changes-header-right">
          {state.kind === "ready" && (
            <span className="changes-count">
              {fileCount} file{fileCount === 1 ? "" : "s"}
            </span>
          )}
          <span className="changes-view-toggle">
            <button
              type="button"
              className={viewMode === "tree" ? "active" : ""}
              onClick={() => setViewMode("tree")}
              title="Tree View"
              aria-label="Tree View"
            >
              <CodiconListTree />
            </button>
            <button
              type="button"
              className={viewMode === "flat" ? "active" : ""}
              onClick={() => setViewMode("flat")}
              title="Flatten List"
              aria-label="Flatten List"
            >
              <CodiconListFlat />
            </button>
          </span>
        </span>
      </header>

      <div className="changes-body">
        {state.kind === "loading" && (
          <div
            className="changes-state"
            data-testid="changes-state"
            data-state="loading"
          >
            Loading changes...
          </div>
        )}
        {state.kind === "error" && (
          <div
            className="changes-state"
            data-testid="changes-state"
            data-state="error"
          >
            Unable to load this comparison: {state.message}
          </div>
        )}
        {state.kind === "ready" && state.files.length === 0 && (
          <div
            className="changes-state"
            data-testid="changes-state"
            data-state="empty"
          >
            These commits have identical contents.
          </div>
        )}
        {state.kind === "ready" && state.files.length > 0 && (
          <FileTree
            files={state.files}
            viewMode={viewMode}
            selectedFiles={selectedPath ? [selectedPath] : []}
            onFileClick={(_event, file) =>
              setSelectedPath(file.newPath || file.oldPath)
            }
            onFileDoubleClick={openDiff}
            collapsed={collapsed}
            onToggle={(key) =>
              setCollapsed((previous) => ({
                ...previous,
                [key]: !previous[key],
              }))
            }
          />
        )}
      </div>
    </div>
  );
}
