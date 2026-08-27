import { useCallback, useEffect, useState } from "react";
import { bridge } from "../shared/bridge";
import { RepoSwitcher } from "../shared/components/RepoSwitcher";
import { Tooltip } from "../shared/components/Tooltip";
import "../shared/components/Tooltip.css";
import {
  applyRepoSwitch,
  pruneRemovedDrafts,
  useCommitStore,
} from "../shared/store/commit-store";
import { subscribeRepoEvents, useRepoStore } from "../shared/store/repo-store";
import { CommitTab } from "./components/CommitTab";
import { IdeaShelfTab } from "./components/IdeaShelfTab";
import { OperationErrorBanner } from "./components/OperationErrorBanner";
import { ShelfTab } from "./components/ShelfTab";
import "./commit.css";

function ProgressBar({ visible }: { visible: boolean }) {
  return (
    <div className={`commit-progress-bar ${visible ? "" : "hidden"}`}>
      {visible && <div className="commit-progress-bar-inner" />}
    </div>
  );
}

interface RebaseState {
  isRebasing: boolean;
  branchName?: string;
  step?: number;
  totalSteps?: number;
}

export function RebaseBanner({ repoId }: { repoId: string | null }) {
  const [state, setState] = useState<RebaseState>({ isRebasing: false });
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const result = (await bridge.request(
        "getRebaseState",
        {},
        { repoId: repoId ?? undefined },
      )) as RebaseState;
      setState(result);
    } catch {
      setState({ isRebasing: false });
    }
  }, [repoId]);

  useEffect(() => {
    fetchState();
    const unsub = bridge.onEvent((event) => {
      if (event === "gitStateChanged" || event === "commitStateChanged") {
        fetchState();
      }
    });
    return unsub;
  }, [fetchState]);

  const handleAction = useCallback(
    async (action: "continue" | "abort" | "skip") => {
      setLoading(true);
      try {
        await bridge.request(
          "rebaseAction",
          { action },
          { repoId: repoId ?? undefined },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        bridge
          .request(
            "showErrorNotification",
            { message: msg },
            { scope: "global" },
          )
          .catch(() => {});
      } finally {
        setLoading(false);
        fetchState();
      }
    },
    [fetchState, repoId],
  );

  if (!state.isRebasing) return null;

  const label = state.branchName ? `Rebasing ${state.branchName}` : "Rebasing";
  const progress =
    state.step && state.totalSteps
      ? ` (${state.step}/${state.totalSteps})`
      : "";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "#e8f5e9",
        borderBottom: "1px solid #c8e6c9",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 14 }}>⚠️</span>
      <span style={{ fontWeight: 600, flex: 1, color: "var(--app-fg, #ccc)" }}>
        {label}
        {progress}
      </span>
      <Tooltip text="Continue Rebase (git rebase --continue)">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleAction("continue")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleAction("continue");
            }
          }}
          className="rebase-action-btn rebase-continue"
        >
          {/* JetBrains official expui double chevron >> icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.5 11.5L6 8L2.5 4.5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.5 11.5L12 8L8.5 4.5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
      <Tooltip text="Abort Rebase (git rebase --abort)">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleAction("abort")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleAction("abort");
            }
          }}
          className="rebase-action-btn rebase-abort"
        >
          {/* JetBrains official expui/vcs/abort × icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 12L12 4M12 12L4 4"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
    </div>
  );
}

interface MergeStateInfo {
  isMerging: boolean;
  mergeHead?: string;
  mergeMsg?: string;
}

interface CherryPickStateInfo {
  isCherryPicking: boolean;
  cherryPickHead?: string;
}

export function CherryPickBanner({ repoId }: { repoId: string | null }) {
  const [state, setState] = useState<CherryPickStateInfo>({
    isCherryPicking: false,
  });
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const result = (await bridge.request(
        "getCherryPickState",
        {},
        { repoId: repoId ?? undefined },
      )) as CherryPickStateInfo;
      setState(result);
    } catch {
      setState({ isCherryPicking: false });
    }
  }, [repoId]);

  useEffect(() => {
    fetchState();
    const unsub = bridge.onEvent((event) => {
      if (event === "gitStateChanged" || event === "commitStateChanged") {
        fetchState();
      }
    });
    return unsub;
  }, [fetchState]);

  const handleAction = useCallback(
    async (action: "continue" | "abort" | "skip") => {
      setLoading(true);
      try {
        await bridge.request(
          "cherryPickAction",
          { action },
          { repoId: repoId ?? undefined },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        bridge
          .request(
            "showErrorNotification",
            { message: msg },
            { scope: "global" },
          )
          .catch(() => {});
      } finally {
        setLoading(false);
        fetchState();
      }
    },
    [fetchState, repoId],
  );

  if (!state.isCherryPicking) return null;

  const shortHash = state.cherryPickHead
    ? state.cherryPickHead.substring(0, 7)
    : "";
  const label = shortHash ? `Cherry-picking ${shortHash}` : "Cherry-picking";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "var(--vscode-inputValidation-warningBackground, #352a05)",
        borderBottom:
          "1px solid var(--vscode-inputValidation-warningBorder, #665500)",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 14 }}>🍒</span>
      <span style={{ fontWeight: 600, flex: 1, color: "var(--app-fg, #ccc)" }}>
        {label}
      </span>
      <Tooltip text="Continue Cherry-pick (git cherry-pick --continue)">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleAction("continue")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleAction("continue");
            }
          }}
          className="rebase-action-btn rebase-continue"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.5 11.5L6 8L2.5 4.5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.5 11.5L12 8L8.5 4.5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
      <Tooltip text="Skip Cherry-pick (git cherry-pick --skip)">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleAction("skip")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleAction("skip");
            }
          }}
          className="rebase-action-btn rebase-continue"
          style={{ background: "#fb8c00" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 4L11 8L5 12"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
      <Tooltip text="Abort Cherry-pick (git cherry-pick --abort)">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleAction("abort")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleAction("abort");
            }
          }}
          className="rebase-action-btn rebase-abort"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 12L12 4M12 12L4 4"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
    </div>
  );
}

export function MergeBanner({ repoId }: { repoId: string | null }) {
  const [state, setState] = useState<MergeStateInfo>({ isMerging: false });
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const result = (await bridge.request(
        "getMergeState",
        {},
        { repoId: repoId ?? undefined },
      )) as MergeStateInfo;
      setState(result);
    } catch {
      setState({ isMerging: false });
    }
  }, [repoId]);

  useEffect(() => {
    fetchState();
    const unsub = bridge.onEvent((event) => {
      if (event === "gitStateChanged" || event === "commitStateChanged") {
        fetchState();
      }
    });
    return unsub;
  }, [fetchState]);

  const handleContinue = useCallback(async () => {
    setLoading(true);
    try {
      // Check if there are unresolved conflicts
      const conflicts = (await bridge.request(
        "getConflictFiles",
        {},
        { repoId: repoId ?? undefined },
      )) as string[];
      if (conflicts && conflicts.length > 0) {
        // Open conflicts panel to let user resolve
        await bridge.request(
          "openConflictsPanel",
          {},
          { repoId: repoId ?? undefined },
        );
      } else {
        // All conflicts resolved, commit
        await bridge.request(
          "mergeAction",
          { action: "continue" },
          { repoId: repoId ?? undefined },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bridge
        .request("showErrorNotification", { message: msg }, { scope: "global" })
        .catch(() => {});
    } finally {
      setLoading(false);
      fetchState();
    }
  }, [fetchState, repoId]);

  const handleAbort = useCallback(async () => {
    setLoading(true);
    try {
      await bridge.request(
        "mergeAction",
        { action: "abort" },
        { repoId: repoId ?? undefined },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bridge
        .request("showErrorNotification", { message: msg }, { scope: "global" })
        .catch(() => {});
    } finally {
      setLoading(false);
      fetchState();
    }
  }, [fetchState, repoId]);

  if (!state.isMerging) return null;

  // Parse branch name from merge message like "Merge branch 'feature' into main"
  let label = "Merging";
  if (state.mergeMsg) {
    const match = state.mergeMsg.match(
      /Merge (?:branch '([^']+)'|remote-tracking branch '([^']+)')/,
    );
    if (match) {
      label = `Merging ${match[1] || match[2]}`;
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        // The banner tokens are made for exactly this: a notice strip whose
        // foreground is guaranteed readable on its own background in every
        // theme. The previous pairing was a fixed light green under
        // --app-fg, which is a light foreground, so the label washed out.
        background: "var(--vscode-banner-background, #04395e)",
        color: "var(--vscode-banner-foreground, #fff)",
        borderBottom: "1px solid var(--border, #333)",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 14,
          color: "var(--vscode-banner-iconForeground, #3794ff)",
        }}
      >
        ⚠️
      </span>
      <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
      <Tooltip text="Resolve Conflicts" position="top">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleContinue()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleContinue();
            }
          }}
          className="rebase-action-btn rebase-continue"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.5 11.5L6 8L2.5 4.5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.5 11.5L12 8L8.5 4.5"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
      <Tooltip text="Abort Merge (git merge --abort)" position="top">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={loading}
          onClick={() => !loading && handleAbort()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!loading) handleAbort();
            }
          }}
          className="rebase-action-btn rebase-abort"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 12L12 4M12 12L4 4"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Tooltip>
    </div>
  );
}

export function CommitApp() {
  const activeTab = useCommitStore((s) => s.activeTab);
  const setActiveTab = useCommitStore((s) => s.setActiveTab);
  const loading = useCommitStore((s) => s.loading);
  const operationError = useCommitStore((s) => s.operationError);
  const repos = useRepoStore((s) => s.repos);
  const activeRepoId = useRepoStore((s) => s.activeRepoId);

  useEffect(() => {
    subscribeRepoEvents();
    let disposed = false;
    let bootstrapping = true;
    let lastRepo: string | null = null;
    const unsub = useRepoStore.subscribe((s) => {
      if (bootstrapping) return;
      if (s.activeRepoId !== lastRepo) {
        const prev = lastRepo;
        lastRepo = s.activeRepoId;
        if (!disposed) void applyRepoSwitch(prev, s.activeRepoId);
      }
      pruneRemovedDrafts(s.repos.map((r) => r.id));
    });
    void (async () => {
      await useRepoStore.getState().load();
      if (disposed) return;
      bootstrapping = false;
      lastRepo = useRepoStore.getState().activeRepoId;
      await applyRepoSwitch(null, lastRepo);
    })();
    return () => {
      disposed = true;
      unsub();
    };
  }, []);

  return (
    <div className="commit-app">
      {repos.length > 1 && (
        <div
          style={{
            flexShrink: 0,
            padding: "4px 8px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <RepoSwitcher disabled={loading} />
        </div>
      )}
      <div className="commit-tabs">
        <button
          type="button"
          className={`commit-tab ${activeTab === "commit" ? "active" : ""}`}
          onClick={() => setActiveTab("commit")}
        >
          Commit
        </button>
        <button
          type="button"
          className={`commit-tab ${activeTab === "shelf" ? "active" : ""}`}
          onClick={() => setActiveTab("shelf")}
        >
          Shelf
        </button>
        <button
          type="button"
          className={`commit-tab ${activeTab === "stash" ? "active" : ""}`}
          onClick={() => setActiveTab("stash")}
        >
          Stash
        </button>
      </div>
      <RebaseBanner
        key={`rebase-${activeRepoId ?? "none"}`}
        repoId={activeRepoId}
      />
      <CherryPickBanner
        key={`cherry-${activeRepoId ?? "none"}`}
        repoId={activeRepoId}
      />
      <MergeBanner
        key={`merge-${activeRepoId ?? "none"}`}
        repoId={activeRepoId}
      />
      <ProgressBar visible={loading} />
      <OperationErrorBanner error={operationError} />
      <div className="commit-content">
        {activeTab === "commit" && <CommitTab />}
        {activeTab === "shelf" && <IdeaShelfTab />}
        {activeTab === "stash" && <ShelfTab />}
      </div>
    </div>
  );
}
